import { nanoid } from 'nanoid';
import type { Context } from '../context';
import db from '../service/db';

export type PasteMode = 'code' | 'markdown';
export type PasteExpire = 'day' | 'week' | 'month' | 'never';

export interface PasteDoc {
    _id: string;
    owner: number;
    title: string;
    mode: PasteMode;
    language: string;
    content: string;
    expire: PasteExpire;
    createdAt: Date;
    updatedAt: Date;
    expireAt?: Date;
}

const EXPIRE_MS: Record<Exclude<PasteExpire, 'never'>, number> = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
};

export function resolveExpireAt(expire: PasteExpire, now = new Date()) {
    if (expire === 'never') return undefined;
    return new Date(now.getTime() + EXPIRE_MS[expire]);
}

export function isExpired(pdoc: Pick<PasteDoc, 'expireAt'>, now = new Date()) {
    return !!pdoc.expireAt && pdoc.expireAt.getTime() <= now.getTime();
}

class PasteModel {
    static coll = db.collection('paste');

    static async add(owner: number, data: Omit<PasteDoc, '_id' | 'owner' | 'createdAt' | 'updatedAt' | 'expireAt'>) {
        const now = new Date();
        const expireAt = resolveExpireAt(data.expire, now);
        for (let attempt = 0; attempt < 8; attempt++) {
            const pdoc: PasteDoc = {
                _id: nanoid(12),
                owner,
                createdAt: now,
                updatedAt: now,
                ...data,
                ...(expireAt ? { expireAt } : {}),
            };
            try {
                // A duplicate is possible only on the short random id; retry generation.
                // eslint-disable-next-line no-await-in-loop
                await this.coll.insertOne(pdoc);
                return pdoc;
            } catch (error: any) {
                if (error?.code !== 11000 || attempt === 7) throw error;
            }
        }
        throw new Error('Unable to generate paste id');
    }

    static async get(id: string) {
        const pdoc = await this.coll.findOne({ _id: id });
        if (!pdoc) return null;
        if (!isExpired(pdoc)) return pdoc;
        await this.coll.deleteOne({ _id: id });
        return null;
    }

    static getMultiByOwner(owner: number) {
        const now = new Date();
        return this.coll.find({
            owner,
            $or: [{ expireAt: { $exists: false } }, { expireAt: { $gt: now } }],
        }).sort({ updatedAt: -1 });
    }

    static async edit(id: string, data: Omit<PasteDoc, '_id' | 'owner' | 'createdAt' | 'updatedAt' | 'expireAt'>) {
        const now = new Date();
        const expireAt = resolveExpireAt(data.expire, now);
        return await this.coll.findOneAndUpdate(
            { _id: id },
            {
                $set: { ...data, updatedAt: now, ...(expireAt ? { expireAt } : {}) },
                ...(expireAt ? {} : { $unset: { expireAt: 1 } }),
            },
            { returnDocument: 'after' },
        );
    }

    static async del(id: string) {
        return !!(await this.coll.deleteOne({ _id: id })).deletedCount;
    }
}

export async function apply(ctx: Context) {
    await ctx.db.ensureIndexes(
        PasteModel.coll,
        { key: { owner: 1, updatedAt: -1 }, name: 'owner' },
        { key: { expireAt: 1 }, name: 'expire', expireAfterSeconds: 0, sparse: true },
    );
}

global.Hydro.model.paste = PasteModel;
export default PasteModel;
