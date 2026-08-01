import type { CheckinDoc } from '../interface';
import {
    checkinDocId, checkinHistoryRange, createCheckin, requestHitokoto, utc8Date,
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

export async function getToday(uid: number, now = new Date()) {
    const date = utc8Date(now);
    return { date, record: await getByDate(uid, date) };
}

export async function add(uid: number, options: CheckinOptions = {}) {
    return await createCheckin(uid, {
        repository,
        clock: options.clock,
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
