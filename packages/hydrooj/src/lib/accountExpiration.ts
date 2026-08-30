import moment from 'moment-timezone';

export const ACCOUNT_EXPIRE_BAN_REASON = 'Account expired.';

export function accountExpireAtFromDate(date: string, timeZone: string): Date {
    const value = moment.tz(date, 'YYYY-MM-DD', true, timeZone);
    if (!value.isValid()) throw new Error('Invalid account expiration date');
    return value.add(1, 'day').startOf('day').toDate();
}

export function accountExpireDate(expireAt: Date, timeZone: string): string {
    return moment(expireAt).tz(timeZone).subtract(1, 'millisecond').format('YYYY-MM-DD');
}

export function adjustAccountExpireAt(expireAt: Date, days: number, timeZone: string): Date {
    const date = accountExpireDate(expireAt, timeZone);
    const adjusted = moment.tz(date, 'YYYY-MM-DD', true, timeZone).add(days, 'days').format('YYYY-MM-DD');
    return accountExpireAtFromDate(adjusted, timeZone);
}

export function isAccountExpired(expireAt?: Date | null, now = new Date()): boolean {
    return !!expireAt && expireAt.getTime() <= now.getTime();
}
