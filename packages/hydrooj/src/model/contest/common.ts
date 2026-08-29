import { Time } from '@hydrooj/utils/lib/utils';
import type { ContestRule, ContestStatusDoc, Tdoc } from '../../interface';
import { Optional } from '../../typeutils';
export enum PrintTaskStatus {
    pending = 'pending',
    printing = 'printing',
    printed = 'printed',
    failed = 'failed',
}

export function isNew(tdoc: Tdoc, days = 1) {
    const readyAt = tdoc.beginAt.getTime();
    return Date.now() < readyAt - days * Time.day;
}

export function isUpcoming(tdoc: Tdoc, days = 7) {
    const now = Date.now();
    const readyAt = tdoc.beginAt.getTime();
    return (now > readyAt - days * Time.day && now < readyAt);
}

export function isNotStarted(tdoc: Tdoc) {
    return (new Date()) < tdoc.beginAt;
}

export function isOngoing(tdoc: Tdoc, tsdoc?: ContestStatusDoc): boolean {
    const now = new Date();
    if (tsdoc?.endAt && tsdoc.endAt <= now) return false;
    if (tsdoc && tdoc.duration && tsdoc.startAt <= new Date(Date.now() - Math.floor(tdoc.duration * Time.hour))) return false;
    return (tdoc.beginAt <= now && now < tdoc.endAt);
}

export function isDone(tdoc: Tdoc, tsdoc?: ContestStatusDoc): boolean {
    if (tdoc.endAt <= new Date()) return true;
    if (tsdoc?.endAt && tsdoc.endAt <= new Date()) return true;
    if (tsdoc && tdoc.duration && tsdoc.startAt <= new Date(Date.now() - Math.floor(tdoc.duration * Time.hour))) return true;
    return false;
}

export function isLocked(tdoc: Tdoc, time = new Date()) {
    if (!tdoc.lockAt) return false;
    return tdoc.lockAt < time && !tdoc.unlocked;
}

export function isExtended(tdoc: Tdoc) {
    const now = Date.now();
    return tdoc.penaltySince.getTime() <= now && now < tdoc.endAt.getTime();
}

export function buildContestRule<T>(def: Optional<ContestRule<T>, 'applyProjection'>): ContestRule<T>;
export function buildContestRule<T>(def: Partial<ContestRule<T>>, baseRule: ContestRule<T>): ContestRule<T>;
export function buildContestRule<T>(def: Partial<ContestRule<T>>, baseRule: ContestRule<T> = {} as any) {
    const base = baseRule._originalRule || { applyProjection: (_, rdoc) => rdoc };
    const funcs = ['scoreboard', 'scoreboardRow', 'scoreboardHeader', 'stat', 'applyProjection'];
    const f = {};
    const rule = { ...baseRule, ...def };
    for (const key of funcs) {
        f[key] = def[key] || base[key];
        rule[key] = f[key].bind(rule);
    }
    rule._originalRule = f;
    return rule;
}
