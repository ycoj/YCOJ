import assert from 'assert';
import { describe, it } from 'node:test';

function mockModule(request: string, exports: unknown) {
    const filename = require.resolve(request);
    require.cache[filename] = { exports } as NodeJS.Module;
}

Object.assign(global, { Hydro: { model: {}, ui: {} } });
mockModule('../src/service/db', {
    collection: () => ({
        insertOne: async () => {},
        findOne: async () => null,
        deleteOne: async () => ({ deletedCount: 0 }),
        find: () => ({ sort: () => ({}) }),
        findOneAndUpdate: async () => null,
    }),
});
const { isExpired, resolveExpireAt } = require('../src/model/paste') as typeof import('../src/model/paste');

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
});

describe('pastebin content contract', () => {
    it('keeps significant whitespace in stored content', () => {
        const value = '  code();\n\n';
        assert.equal(value.length, 11);
        assert.equal(value.startsWith('  '), true);
        assert.equal(value.endsWith('\n\n'), true);
    });
});
