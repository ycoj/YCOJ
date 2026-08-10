import type { CheckinDoc } from '../interface';
import {
    checkinDocId, checkinHistoryRange, createCheckin, requestHitokoto,
    streakForNewCheckin, utc8Date,
} from '../lib/checkin';
import * as DocumentModel from './document';
import { TYPE_CHECKIN } from './document';
import system from './system';

export const CHECKIN_DOMAIN_ID = 'system';

const repository = {
    async get(docId: string) {
        return await DocumentModel.get(CHECKIN_DOMAIN_ID, TYPE_CHECKIN, docId);
    },
    async insert(data) {
        const {
            content, docId, owner, ...args
        } = data;
        await DocumentModel.add(
            CHECKIN_DOMAIN_ID, content, owner, TYPE_CHECKIN, docId,
            undefined, undefined, args,
        );
    },
};

export interface CheckinOptions {
    clock?: () => Date;
    random?: () => number;
    fetchHitokoto?: typeof requestHitokoto extends (url: string) => Promise<infer T>
        ? () => Promise<T> : never;
}

export function getByDate(uid: number, localDate: string) {
    return DocumentModel.get(
        CHECKIN_DOMAIN_ID, TYPE_CHECKIN, checkinDocId(uid, localDate),
    );
}

/**
 * One-time lazy fill for docs created before streak was a write-time field.
 * Walks consecutive prior days once, then persists on the doc.
 */
async function ensureStreak(record: CheckinDoc): Promise<CheckinDoc> {
    if (typeof record.streak === 'number' && Number.isSafeInteger(record.streak) && record.streak >= 1) {
        return record;
    }
    const streak = await streakForNewCheckin(
        record.owner,
        record.localDate,
        (docId) => DocumentModel.get(CHECKIN_DOMAIN_ID, TYPE_CHECKIN, docId),
    );
    await DocumentModel.set(CHECKIN_DOMAIN_ID, TYPE_CHECKIN, record.docId, { streak });
    return { ...record, streak };
}

export async function getToday(uid: number, now = new Date()) {
    const date = utc8Date(now);
    const record = await getByDate(uid, date);
    if (!record) return { date, record: null };
    return { date, record: await ensureStreak(record) };
}

export async function add(uid: number, options: CheckinOptions = {}) {
    const clock = options.clock || (() => new Date());
    return await createCheckin(uid, {
        repository,
        clock,
        random: options.random,
        fetchHitokoto: options.fetchHitokoto
            || (() => requestHitokoto(system.get('checkin.hitokotoUrl'))),
    });
}

export async function getHistory(uid: number, now = new Date()) {
    const range = checkinHistoryRange(now);
    const records = await DocumentModel.getMulti(CHECKIN_DOMAIN_ID, TYPE_CHECKIN, {
        owner: uid,
        localDate: { $gte: range.from, $lte: range.to },
    }).sort({ localDate: 1 }).toArray() as CheckinDoc[];
    return { ...range, records };
}

global.Hydro.model.checkin = {
    CHECKIN_DOMAIN_ID,
    add,
    getByDate,
    getHistory,
    getToday,
};
