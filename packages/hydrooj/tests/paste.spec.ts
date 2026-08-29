import assert from 'assert';
import { describe, it } from 'node:test';
import { Types } from '@hydrooj/framework';

function mockModule(request: string, exports: unknown) {
    const filename = require.resolve(request);
    require.cache[filename] = { exports } as NodeJS.Module;
}

const captured: { insert?: Record<string, unknown>, find?: Record<string, unknown>, update?: Record<string, unknown> } = {};

Object.assign(global, { Hydro: { model: {}, ui: {} } });
mockModule('../src/service/db', {
    collection: () => ({
        insertOne: async (doc: Record<string, unknown>) => {
            captured.insert = doc;
        },
        findOne: async () => null,
        deleteOne: async () => ({ deletedCount: 0 }),
        find: (query: Record<string, unknown>) => {
            captured.find = query;
            return { sort: () => ({}) };
        },
        findOneAndUpdate: async (_filter: unknown, update: Record<string, unknown>) => {
            captured.update = update;
            return null;
        },
    }),
});

const paste = require('../src/model/paste') as typeof import('../src/model/paste');
const PasteModel = paste.default;
const {
    isExpired, languageOptionsFor, PasteContent, pasteWriteData, resolveExpireAt,
} = paste;

describe('pastebin model helpers', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');

    it('calculates finite expirations relative to the supplied time', () => {
        assert.equal(resolveExpireAt('day', now).toISOString(), '2026-08-30T00:00:00.000Z');
        assert.equal(resolveExpireAt('week', now).toISOString(), '2026-09-05T00:00:00.000Z');
        assert.equal(resolveExpireAt('month', now).toISOString(), '2026-09-28T00:00:00.000Z');
        assert.equal(resolveExpireAt('never', now), undefined);
    });

    it('recognizes immediately expired documents', () => {
        assert.equal(isExpired({ expireAt: new Date('2026-08-28T23:59:59.000Z') }, now), true);
        assert.equal(isExpired({ expireAt: new Date('2026-08-29T00:00:00.000Z') }, now), true);
        assert.equal(isExpired({ expireAt: new Date('2026-08-29T00:00:01.000Z') }, now), false);
        assert.equal(isExpired({}, now), false);
    });

    it('omits expireAt when adding a never-expiring paste', async () => {
        await PasteModel.add(1, pasteWriteData('', 'code', '', 'x', 'never'));
        assert.equal(captured.insert?.expire, 'never');
        assert.equal(Object.hasOwn(captured.insert || {}, 'expireAt'), false);
    });

    it('persists expire and derived expireAt when adding a finite expiration', async () => {
        const before = Date.now();
        await PasteModel.add(1, pasteWriteData('', 'code', '', 'x', 'day'));
        const after = Date.now();
        assert.equal(captured.insert?.expire, 'day');
        const expireAt = (captured.insert?.expireAt as Date).getTime();
        assert.ok(expireAt >= before + 24 * 60 * 60 * 1000);
        assert.ok(expireAt <= after + 24 * 60 * 60 * 1000);
    });

    it('lists never-expiring or not-yet-expired owner pastes', () => {
        PasteModel.getMultiByOwner(1);
        const query = captured.find as { owner: number, $or: Record<string, unknown>[] };
        assert.equal(query.owner, 1);
        assert.equal(query.$or.length, 2);
        assert.deepEqual(query.$or[0], { expireAt: { $exists: false } });
        assert.ok((query.$or[1] as { expireAt: { $gt: Date } }).expireAt.$gt instanceof Date);
    });

    it('unsets expireAt when editing to never', async () => {
        await PasteModel.edit('abc', pasteWriteData('', 'code', '', 'x', 'never'));
        assert.equal((captured.update?.$set as Record<string, unknown>).expire, 'never');
        assert.equal(Object.hasOwn((captured.update?.$set as object) || {}, 'expireAt'), false);
        assert.deepEqual(captured.update?.$unset, { expireAt: 1 });
    });
});

describe('pastebin content contract', () => {
    const value = '  code();\n\n';
    const convertContent = (Types.Content as readonly [(v: unknown) => string])[0];

    it('keeps significant whitespace at the schema boundary', () => {
        assert.equal(convertContent(value), 'code();');
        assert.equal(PasteContent(value), value);
    });

    it('stores schema-accepted content without trimming', async () => {
        const content = PasteContent(value);
        await PasteModel.add(1, pasteWriteData('', 'code', '', content, 'never'));
        assert.equal(captured.insert?.content, value);
    });
});

describe('pastebin write payload', () => {
    it('keeps language for code and clears it for markdown', () => {
        assert.deepEqual(pasteWriteData('t', 'code', 'python', 'x', 'week'), {
            title: 't',
            mode: 'code',
            language: 'python',
            content: 'x',
            expire: 'week',
        });
        assert.deepEqual(pasteWriteData('t', 'markdown', 'python', 'x', 'week'), {
            title: 't',
            mode: 'markdown',
            language: '',
            content: 'x',
            expire: 'week',
        });
    });
});

describe('pastebin language options', () => {
    it('returns the built-in map for missing or known languages', () => {
        const known = languageOptionsFor('cpp');
        assert.equal(known.cpp, 'C++');
        assert.equal(Object.hasOwn(known, 'rust'), false);
        assert.equal(languageOptionsFor(''), known);
        assert.equal(languageOptionsFor(), known);
    });

    it('adds custom languages without treating prototype names as known', () => {
        const rust = languageOptionsFor('rust');
        assert.equal(rust.rust, 'rust');
        assert.equal(rust.cpp, 'C++');
        const inherited = languageOptionsFor('constructor');
        assert.equal(inherited.constructor, 'constructor');
        assert.equal(inherited.cpp, 'C++');
    });
});
