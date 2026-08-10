import assert from 'assert';
import {
    describe, it,
} from 'node:test';
import type {
    CheckinData, CheckinRepository, HitokotoSnapshot,
} from '../src/lib/checkin';
import {
    buildCheckinStreakCacheEntry, calculateCheckinStreak, checkinHistoryRange,
    createCheckin, generateFortune, resolveCheckinStreak, shiftDate,
    toCheckinRecord, utc8Date, validateHitokotoResponse,
} from '../src/lib/checkin';

const HITOKOTO: HitokotoSnapshot = {
    id: 7338,
    uuid: '75a45fd4-4f2f-45eb-80cb-6f0a7bcdfaf2',
    text: '用代码表达言语的魅力。',
    type: 'f',
    from: '一言开发者中心',
    fromWho: '一言',
};

function memoryRepository() {
    const records = new Map<string, CheckinData>();
    const repository: CheckinRepository = {
        async get(docId) {
            return records.get(docId) || null;
        },
        async insert(data) {
            await new Promise((resolve) => setImmediate(resolve));
            if (records.has(data.docId)) {
                throw Object.assign(new Error('duplicate key'), { code: 11000 });
            }
            records.set(data.docId, data);
        },
    };
    return { records, repository };
}

describe('check-in UTC+8 dates', () => {
    it('changes date exactly at UTC+8 midnight', () => {
        assert.equal(utc8Date(new Date('2026-07-31T15:59:59.999Z')), '2026-07-31');
        assert.equal(utc8Date(new Date('2026-07-31T16:00:00.000Z')), '2026-08-01');
    });

    it('does not depend on the server timezone', () => {
        const originalTimezone = process.env.TZ;
        try {
            for (const timezone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
                process.env.TZ = timezone;
                assert.equal(utc8Date(new Date('2026-07-31T16:00:00.000Z')), '2026-08-01');
            }
        } finally {
            if (originalTimezone === undefined) delete process.env.TZ;
            else process.env.TZ = originalTimezone;
        }
    });

    it('handles month end, year end, and leap day', () => {
        assert.equal(utc8Date(new Date('2026-01-31T16:00:00.000Z')), '2026-02-01');
        assert.equal(utc8Date(new Date('2026-12-31T16:00:00.000Z')), '2027-01-01');
        assert.equal(utc8Date(new Date('2024-02-28T16:00:00.000Z')), '2024-02-29');
        assert.equal(shiftDate('2024-02-29', 1), '2024-03-01');
    });

    it('returns an inclusive 365-day range', () => {
        assert.deepEqual(checkinHistoryRange(new Date('2026-08-01T03:00:00.000Z')), {
            from: '2025-08-02',
            to: '2026-08-01',
        });
    });
});

describe('check-in fortune and Hitokoto validation', () => {
    it('maps weighted thresholds to all five fortunes', () => {
        const values = [0, 0.3, 0.6, 0.85, 0.95];
        assert.deepEqual(values.map((value) => generateFortune(() => value)), [
            'da_ji', 'ji', 'ping', 'xiong', 'da_xiong',
        ]);
        assert.equal(generateFortune(() => 0.299999), 'da_ji');
        assert.equal(generateFortune(() => 0.599999), 'ji');
        assert.equal(generateFortune(() => 0.849999), 'ping');
        assert.equal(generateFortune(() => 0.949999), 'xiong');
        assert.equal(generateFortune(() => 0.999999), 'da_xiong');
    });

    it('normalizes an absent or empty author to null', () => {
        const payload = {
            id: 1,
            uuid: 'uuid',
            hitokoto: 'text',
            type: 'a',
            from: 'source',
        };
        assert.equal(validateHitokotoResponse(payload).fromWho, null);
        assert.equal(validateHitokotoResponse({ ...payload, from_who: '' }).fromWho, null);
    });

    it('rejects malformed required fields and unreasonable text', () => {
        const valid = {
            id: 1,
            uuid: 'uuid',
            hitokoto: 'text',
            type: 'a',
            from: 'source',
        };
        for (const invalid of [
            { ...valid, id: '1' },
            { ...valid, uuid: null },
            { ...valid, hitokoto: '   ' },
            { ...valid, hitokoto: 'x'.repeat(201) },
            { ...valid, type: 1 },
            { ...valid, from_who: 1 },
        ]) assert.throws(() => validateHitokotoResponse(invalid));
    });
});

describe('check-in creation', () => {
    it('is idempotent for sequential requests and preserves the first result', async () => {
        const { records, repository } = memoryRepository();
        let fetchCount = 0;
        const dependencies = {
            repository,
            clock: () => new Date('2026-08-01T03:21:45.000Z'),
            random: () => 0,
            fetchHitokoto: async () => {
                fetchCount++;
                return HITOKOTO;
            },
        };
        const first = await createCheckin(2, dependencies);
        const second = await createCheckin(2, dependencies);

        assert.equal(first.created, true);
        assert.equal(second.created, false);
        assert.equal(fetchCount, 1);
        assert.equal(records.size, 1);
        assert.deepEqual(second.data, first.data);
    });

    it('turns a concurrent duplicate-key race into an idempotent success', async () => {
        const { records, repository } = memoryRepository();
        let sequence = 0;
        const dependencies = {
            repository,
            clock: () => new Date('2026-08-01T03:21:45.000Z'),
            random: () => 0.3,
            fetchHitokoto: async () => ({
                ...HITOKOTO,
                id: ++sequence,
                text: `text-${sequence}`,
            }),
        };
        const results = await Promise.all([
            createCheckin(2, dependencies),
            createCheckin(2, dependencies),
            createCheckin(2, dependencies),
        ]);

        assert.equal(records.size, 1);
        assert.equal(results.filter((result) => result.created).length, 1);
        assert.equal(new Set(results.map((result) => result.data.content)).size, 1);
    });

    it('does not insert on failure and allows a later retry', async () => {
        const { records, repository } = memoryRepository();
        let available = false;
        const dependencies = {
            repository,
            clock: () => new Date('2026-08-01T03:21:45.000Z'),
            fetchHitokoto: async () => {
                if (!available) throw new Error('unavailable');
                return HITOKOTO;
            },
        };

        await assert.rejects(() => createCheckin(2, dependencies));
        assert.equal(records.size, 0);
        available = true;
        assert.equal((await createCheckin(2, dependencies)).created, true);
        assert.equal(records.size, 1);
    });

    it('allows a new record on the next UTC+8 day', async () => {
        const { records, repository } = memoryRepository();
        let now = new Date('2026-07-31T15:59:59.999Z');
        const dependencies = {
            repository,
            clock: () => now,
            fetchHitokoto: async () => HITOKOTO,
        };

        assert.equal((await createCheckin(2, dependencies)).data.localDate, '2026-07-31');
        now = new Date('2026-07-31T16:00:00.000Z');
        assert.equal((await createCheckin(2, dependencies)).data.localDate, '2026-08-01');
        assert.equal(records.size, 2);
    });

    it('maps the public DTO without internal document fields', async () => {
        const { repository } = memoryRepository();
        const result = await createCheckin(2, {
            repository,
            clock: () => new Date('2026-08-01T03:21:45.000Z'),
            random: () => 0,
            fetchHitokoto: async () => HITOKOTO,
        });
        assert.deepEqual(toCheckinRecord(result.data), {
            date: '2026-08-01',
            fortune: 'da_ji',
            hitokoto: {
                id: HITOKOTO.id,
                uuid: HITOKOTO.uuid,
                text: HITOKOTO.text,
                type: HITOKOTO.type,
                from: HITOKOTO.from,
                fromWho: HITOKOTO.fromWho,
            },
        });
    });
});

describe('check-in streak', () => {
    it('returns zero when today is not checked in', () => {
        assert.equal(calculateCheckinStreak([], '2026-08-10'), 0);
        assert.equal(calculateCheckinStreak(['2026-08-09'], '2026-08-10'), 0);
        assert.equal(calculateCheckinStreak([
            '2026-08-08', '2026-08-09',
        ], '2026-08-10'), 0);
    });

    it('counts consecutive days ending today', () => {
        assert.equal(calculateCheckinStreak(['2026-08-10'], '2026-08-10'), 1);
        assert.equal(calculateCheckinStreak([
            '2026-08-08', '2026-08-09', '2026-08-10',
        ], '2026-08-10'), 3);
    });

    it('stops at the first gap', () => {
        assert.equal(calculateCheckinStreak([
            '2026-08-07', '2026-08-09', '2026-08-10',
        ], '2026-08-10'), 2);
        assert.equal(calculateCheckinStreak([
            '2026-08-08', '2026-08-10',
        ], '2026-08-10'), 1);
    });

    it('resolves display streak only for today', () => {
        assert.equal(resolveCheckinStreak(null, '2026-08-10'), 0);
        assert.equal(resolveCheckinStreak({ streak: 5, lastDate: '2026-08-10' }, '2026-08-10'), 5);
        assert.equal(resolveCheckinStreak({ streak: 5, lastDate: '2026-08-09' }, '2026-08-10'), 0);
        assert.equal(resolveCheckinStreak({ streak: 0, lastDate: '2026-08-10' }, '2026-08-10'), 0);
    });

    it('builds a cache entry only when today is checked in', () => {
        assert.equal(buildCheckinStreakCacheEntry([], '2026-08-10'), null);
        assert.equal(buildCheckinStreakCacheEntry([
            '2026-08-08', '2026-08-09',
        ], '2026-08-10'), null);
        assert.deepEqual(buildCheckinStreakCacheEntry([
            '2026-08-08', '2026-08-09', '2026-08-10',
        ], '2026-08-10'), { streak: 3, lastDate: '2026-08-10' });
    });

    it('rebuilds streak from history on cold cache when today is already checked in', () => {
        const today = '2026-08-10';
        // Cache miss (process restart / multi-instance / eviction)
        assert.equal(resolveCheckinStreak(null, today), 0);
        assert.equal(resolveCheckinStreak(undefined, today), 0);
        // Existing check-ins in DB, including today — homepage must recalculate, not default to 0
        const dates = ['2026-08-08', '2026-08-09', '2026-08-10'];
        const rebuilt = buildCheckinStreakCacheEntry(dates, today);
        assert.deepEqual(rebuilt, { streak: 3, lastDate: today });
        assert.equal(resolveCheckinStreak(rebuilt, today), 3);
        // Fast path still works after cache is filled
        assert.equal(resolveCheckinStreak({ streak: 3, lastDate: today }, today), 3);
    });
});
