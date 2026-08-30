import assert from 'assert';
import { describe, it } from 'node:test';
import {
    accountExpireAtFromDate, accountExpireDate, adjustAccountExpireAt, isAccountExpired,
} from '../src/lib/accountExpiration';

describe('account expiration dates', () => {
    it('keeps the selected date active through the end of the administrator day', () => {
        const expireAt = accountExpireAtFromDate('2026-09-01', 'Asia/Shanghai');
        assert.equal(expireAt.toISOString(), '2026-09-01T16:00:00.000Z');
        assert.equal(accountExpireDate(expireAt, 'Asia/Shanghai'), '2026-09-01');
        assert.equal(isAccountExpired(expireAt, new Date('2026-09-01T15:59:59.999Z')), false);
        assert.equal(isAccountExpired(expireAt, new Date('2026-09-01T16:00:00.000Z')), true);
    });

    it('uses calendar days across daylight-saving changes', () => {
        const beforeDst = accountExpireAtFromDate('2026-03-07', 'America/Los_Angeles');
        const afterDst = adjustAccountExpireAt(beforeDst, 1, 'America/Los_Angeles');
        assert.equal(beforeDst.toISOString(), '2026-03-08T08:00:00.000Z');
        assert.equal(afterDst.toISOString(), '2026-03-09T07:00:00.000Z');
        assert.equal(accountExpireDate(afterDst, 'America/Los_Angeles'), '2026-03-08');
    });

    it('adjusts across month, year, and leap-day boundaries', () => {
        const leapDay = accountExpireAtFromDate('2024-02-29', 'UTC');
        assert.equal(accountExpireDate(adjustAccountExpireAt(leapDay, 1, 'UTC'), 'UTC'), '2024-03-01');
        assert.equal(accountExpireDate(adjustAccountExpireAt(leapDay, -1, 'UTC'), 'UTC'), '2024-02-28');
        const yearEnd = accountExpireAtFromDate('2026-12-31', 'UTC');
        assert.equal(accountExpireDate(adjustAccountExpireAt(yearEnd, 1, 'UTC'), 'UTC'), '2027-01-01');
    });

    it('treats a missing expiration as unlimited and rejects invalid dates', () => {
        assert.equal(isAccountExpired(undefined), false);
        assert.equal(isAccountExpired(null), false);
        assert.throws(() => accountExpireAtFromDate('2026-02-30', 'UTC'));
        assert.throws(() => accountExpireAtFromDate('09/01/2026', 'UTC'));
    });
});
