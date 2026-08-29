import { nanoid } from 'nanoid';
import Schema from 'schemastery';
import type { Context } from '../context';
import db from '../service/db';

export type PasteMode = 'code' | 'markdown';
export type PasteExpire = 'day' | 'week' | 'month' | 'never';

export const PasteContent = Schema.string().min(1).max(65536);
export const PasteTitle = Schema.string().max(64);
export const PasteLanguage = Schema.string().pattern(/^[a-z0-9-]{0,64}$/i);

export const LANGUAGE_OPTIONS: Record<string, string> = {
    cpp: 'C++',
    python: 'Python',
    javascript: 'JS',
};

export function languageOptionsFor(language = '') {
    if (!language || Object.hasOwn(LANGUAGE_OPTIONS, language)) return LANGUAGE_OPTIONS;
    return { ...LANGUAGE_OPTIONS, [language]: language };
}

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

export type PasteWriteData = Omit<PasteDoc, '_id' | 'owner' | 'createdAt' | 'updatedAt' | 'expireAt'>;

export function pasteWriteData(
    title: string, mode: PasteMode, language: string, content: string, expire: PasteExpire,
): PasteWriteData {
    return {
        title,
        mode,
        language: mode === 'code' ? language : '',
        content,
        expire,
    };
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

    static async add(owner: number, data: PasteWriteData) {
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

    static async edit(id: string, data: PasteWriteData) {
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
