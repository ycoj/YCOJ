import { DEFAULT_GRADES, PRIMARY_OR_NONE_GRADES } from './constants';
import type { GradesConfig, OierContestState } from './types';

export function parseGradesConfig(json?: string): GradesConfig {
    if (!json) return DEFAULT_GRADES;
    const raw = JSON.parse(json) as GradesConfig;
    return {
        initial: raw.initial,
        element: raw.element || {},
        special: Object.fromEntries(
            Object.entries(raw.special || {}).map(([k, v]) => [k, Number(v)]),
        ),
    };
}

export function getGrades(gradeName: string, config: GradesConfig): bigint {
    const special = config.special[gradeName];
    if (special !== undefined) return BigInt(special);
    let ret = config.initial;
    let cur = gradeName;
    while (cur !== '') {
        const element = Object.keys(config.element).find((item) => cur.startsWith(item));
        if (!element) throw new Error(`未知的年级：'${gradeName}'`);
        ret += config.element[element];
        cur = cur.slice(element.length);
    }
    return 1n << BigInt(ret);
}

export function schoolYear(contest: Pick<OierContestState, 'year' | 'fallSemester'>): number {
    return contest.year - (contest.fallSemester ? 0 : 1);
}

export function enrollmentMiddle(contest: Pick<OierContestState, 'year' | 'fallSemester'>, grades: bigint): Map<number, number> {
    const year = schoolYear(contest);
    const isPrimaryOrNone = grades === PRIMARY_OR_NONE_GRADES;
    const ems = new Map<number, number>();
    let mask = grades;
    while (mask !== 0n) {
        const low = mask & -mask;
        const grade = low.toString(2).length - 16;
        ems.set(year - grade + 1, isPrimaryOrNone && grade > 5 ? 1 : 2);
        mask &= mask - 1n;
    }
    return ems;
}

export function weightedMode(dicts: Map<number, number>[]): number[] {
    const counter = new Map<number, number>();
    for (const d of dicts) {
        for (const [k, v] of d) counter.set(k, (counter.get(k) || 0) + v);
    }
    let most = 0;
    for (const v of counter.values()) most = Math.max(most, v);
    return [...counter.entries()].filter(([, v]) => v === most).map(([k]) => k).sort((a, b) => a - b);
}
