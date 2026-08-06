import PQueue from 'p-queue';
import superagent from 'superagent';
import { HitokotoUnavailableError } from '../error';
import type {
    CheckinDoc, CheckinFortune, CheckinRecord,
} from '../interface';

export const CHECKIN_TIMEZONE = 'UTC+08:00';
export const CHECKIN_HISTORY_DAYS = 365;
export const CHECKIN_FORTUNES = [
    'da_ji', 'ji', 'ping', 'xiong', 'da_xiong',
] as const satisfies readonly CheckinFortune[];
export const CHECKIN_FORTUNE_WEIGHTS = [0.3, 0.3, 0.25, 0.1, 0.05];

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_HITOKOTO_LENGTH = 200;
const MAX_METADATA_LENGTH = 200;
const officialHitokotoQueue = new PQueue({
    interval: 1000,
    intervalCap: 2,
    strict: true,
});

export interface HitokotoSnapshot {
    id: number;
    uuid: string;
    text: string;
    type: string;
    from: string;
    fromWho: string | null;
}

export type CheckinData = Pick<
    CheckinDoc,
    | 'docId' | 'owner' | 'content' | 'localDate' | 'fortune'
    | 'hitokotoId' | 'hitokotoUuid' | 'hitokotoType'
    | 'hitokotoFrom' | 'hitokotoFromWho' | 'createdAt'
>;

export interface CheckinRepository {
    get(docId: string): Promise<CheckinData | null>;
    insert(data: CheckinData): Promise<void>;
}

export interface CreateCheckinDependencies {
    repository: CheckinRepository;
    fetchHitokoto: () => Promise<HitokotoSnapshot>;
    clock?: () => Date;
    random?: () => number;
    isDuplicateError?: (error: unknown) => boolean;
}

export interface CreateCheckinResult {
    created: boolean;
    data: CheckinData;
}

function getRequiredString(
    value: unknown, field: string, maxLength = MAX_METADATA_LENGTH,
): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
        throw new TypeError(`Invalid Hitokoto field: ${field}`);
    }
    return value;
}

export function utc8Date(now = new Date()): string {
    if (Number.isNaN(now.getTime())) throw new TypeError('Invalid date');
    return new Date(now.getTime() + UTC8_OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('Invalid local date');
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new TypeError('Invalid local date');
    }
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
}

export function checkinHistoryRange(now = new Date()) {
    const to = utc8Date(now);
    return { from: shiftDate(to, -(CHECKIN_HISTORY_DAYS - 1)), to };
}

export function checkinDocId(uid: number, localDate: string): string {
    return `${uid}:${localDate}`;
}

export function generateFortune(random = Math.random): CheckinFortune {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new RangeError('Random value must be in [0, 1)');
    }
    let cumulative = 0;
    for (let i = 0; i < CHECKIN_FORTUNES.length; i++) {
        cumulative += CHECKIN_FORTUNE_WEIGHTS[i];
        if (value < cumulative) return CHECKIN_FORTUNES[i];
    }
    return CHECKIN_FORTUNES[CHECKIN_FORTUNES.length - 1];
}

export function validateHitokotoResponse(value: unknown): HitokotoSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Invalid Hitokoto response');
    }
    const payload = value as Record<string, unknown>;
    if (!Number.isSafeInteger(payload.id) || (payload.id as number) < 0) {
        throw new TypeError('Invalid Hitokoto field: id');
    }
    let fromWho: string | null = null;
    if (payload.from_who !== undefined && payload.from_who !== null && payload.from_who !== '') {
        fromWho = getRequiredString(payload.from_who, 'from_who');
    }
    return {
        id: payload.id as number,
        uuid: getRequiredString(payload.uuid, 'uuid'),
        text: getRequiredString(payload.hitokoto, 'hitokoto', MAX_HITOKOTO_LENGTH),
        type: getRequiredString(payload.type, 'type'),
        from: getRequiredString(payload.from, 'from'),
        fromWho,
    };
}

function decodeResponseBody(body: unknown, text: string): unknown {
    if (body && typeof body === 'object') return body;
    if (typeof body === 'string' && body) return JSON.parse(body);
    if (text) return JSON.parse(text);
    throw new TypeError('Empty Hitokoto response');
}

export async function requestHitokoto(endpoint: string): Promise<HitokotoSnapshot> {
    try {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:') throw new TypeError('Hitokoto URL must use HTTPS');
        const request = async () => {
            const response = await superagent.get(url.toString())
                .accept('json')
                .redirects(0)
                .timeout({ response: 3000, deadline: 5000 });
            return validateHitokotoResponse(decodeResponseBody(response.body, response.text));
        };
        if (url.hostname === 'v1.hitokoto.cn') return await officialHitokotoQueue.add(request);
        return await request();
    } catch (error) {
        if (error instanceof HitokotoUnavailableError) throw error;
        throw new HitokotoUnavailableError();
    }
}

export async function createCheckin(
    uid: number, dependencies: CreateCheckinDependencies,
): Promise<CreateCheckinResult> {
    const clock = dependencies.clock || (() => new Date());
    const localDate = utc8Date(clock());
    const docId = checkinDocId(uid, localDate);
    const existing = await dependencies.repository.get(docId);
    if (existing) return { created: false, data: existing };

    const hitokoto = await dependencies.fetchHitokoto();
    const data: CheckinData = {
        docId,
        owner: uid,
        content: hitokoto.text,
        localDate,
        fortune: generateFortune(dependencies.random),
        hitokotoId: hitokoto.id,
        hitokotoUuid: hitokoto.uuid,
        hitokotoType: hitokoto.type,
        hitokotoFrom: hitokoto.from,
        hitokotoFromWho: hitokoto.fromWho,
        createdAt: clock(),
    };
    try {
        await dependencies.repository.insert(data);
        return { created: true, data };
    } catch (error) {
        const isDuplicate = dependencies.isDuplicateError?.(error)
            ?? (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000);
        if (!isDuplicate) throw error;
        const concurrent = await dependencies.repository.get(docId);
        if (!concurrent) throw error;
        return { created: false, data: concurrent };
    }
}

export function toCheckinRecord(data: CheckinData): CheckinRecord {
    return {
        date: data.localDate,
        fortune: data.fortune,
        hitokoto: {
            id: data.hitokotoId,
            uuid: data.hitokotoUuid,
            text: data.content,
            type: data.hitokotoType,
            from: data.hitokotoFrom,
            fromWho: data.hitokotoFromWho,
        },
    };
}
