import { LRUCache } from 'lru-cache';
import type { CheckinDoc } from '../interface';
import {
    buildCheckinStreakCacheEntry, checkinDocId, checkinHistoryRange,
    type CheckinStreakCacheEntry, createCheckin, requestHitokoto,
    resolveCheckinStreak, utc8Date,
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

/** Per-process streak cache; filled/refreshed on check-in only. */
const streakCache = new LRUCache<number, CheckinStreakCacheEntry>({
    max: 10000,
    ttl: 7 * 24 * 60 * 60 * 1000,
});

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

export async function getToday(uid: number, now = new Date()) {
    const date = utc8Date(now);
    return { date, record: await getByDate(uid, date) };
}

/**
 * Cache-only streak for homepage (only meaningful after today's check-in).
 * Does not scan check-in history. Cold cache returns 0 until the next check-in.
 */
export function getStreak(uid: number, now = new Date()): number {
    return resolveCheckinStreak(streakCache.get(uid), utc8Date(now));
}

/**
 * Scan all of the user's check-in dates and refresh the LRU entry.
 * Intended to run on check-in, not on homepage loads.
 */
export async function recalculateAndCache(uid: number, now = new Date()) {
    const today = utc8Date(now);
    const records = await DocumentModel.getMulti(
        CHECKIN_DOMAIN_ID,
        TYPE_CHECKIN,
        { owner: uid, localDate: { $lte: today } },
        ['localDate'],
    ).toArray() as Pick<CheckinDoc, 'localDate'>[];
    const entry = buildCheckinStreakCacheEntry(
        records.map((record) => record.localDate),
        today,
    );
    if (entry) streakCache.set(uid, entry);
    else streakCache.delete(uid);
    return entry ? entry.streak : 0;
}

export async function add(uid: number, options: CheckinOptions = {}) {
    const clock = options.clock || (() => new Date());
    const result = await createCheckin(uid, {
        repository,
        clock,
        random: options.random,
        fetchHitokoto: options.fetchHitokoto
            || (() => requestHitokoto(system.get('checkin.hitokotoUrl'))),
    });
    await recalculateAndCache(uid, clock());
    return result;
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
    getStreak,
    getToday,
    recalculateAndCache,
};
