import { CCF_SCORE_LEVELS, NOI_CCF_LEVEL, OTHER_CCF_BASE } from './constants';
import type { OierRecord } from './types';

function contestantCount(record: OierRecord): number {
    const { contest } = record;
    return contest.capacity || contest.contestants.length;
}

function firstPrizePool(record: OierRecord): number {
    const { contest } = record;
    if (contest.capacity) return contest.capacity;
    return (contest.levelCounts.get('一等奖') || 0) * 5;
}

export function computeCcf(records: OierRecord[]): { ccfLevel: number, ccfScore: number } {
    const ordered = [...records].sort((a, b) => a.contest.id - b.contest.id);
    let level = 0;
    const scores = new Map<string, number>();
    for (const record of ordered) {
        const { type } = record.contest;
        if (type === 'NOI') {
            level = Math.max(level, NOI_CCF_LEVEL[record.level] || 0);
        } else if (type === 'NOIP' || type === 'NOIP提高' || type === 'CSP提高') {
            const n = firstPrizePool(record);
            if (record.rank * 10 <= n) level = Math.max(level, 7);
            else if (record.rank * 5 <= n) level = Math.max(level, 6);
            else if (record.rank * 2 <= n) level = Math.max(level, 4);
            else level = Math.max(level, 3);
        } else if (type === 'NOIP普及' || type === 'CSP入门') {
            const n = firstPrizePool(record);
            if (record.rank * 5 <= n) level = Math.max(level, 5);
            else if (record.rank * 2 <= n) level = Math.max(level, 4);
            else level = Math.max(level, 3);
        } else if (OTHER_CCF_BASE[type]) {
            const base = OTHER_CCF_BASE[type];
            const n = contestantCount(record);
            const gained = n <= 1 ? base : base - (record.rank - 1) * (base - 50) / (n - 1);
            scores.set(type, Math.max(scores.get(type) || 0, gained));
        }
    }
    const score = [...scores.values()].reduce((a, b) => a + b, 0);
    for (const [need, lvl] of CCF_SCORE_LEVELS) {
        if (score >= need) level = Math.max(level, lvl);
    }
    return { ccfLevel: level, ccfScore: score };
}
