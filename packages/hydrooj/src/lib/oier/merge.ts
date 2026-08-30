import { CONTEST_TYPE_FAMILY, MERGE_THRESHOLD, SCHOOL_PENALTY } from './constants';
import { computeCcf } from './ccf';
import { schoolYear, weightedMode } from './grades';
import type { OierRecord, ParsedOier, ParsedOierRecord } from './types';

const INF = MERGE_THRESHOLD + 1;

function locationOf(record: OierRecord) {
    return `${record.school.province},${record.school.city}`;
}

function emKeys(record: OierRecord) {
    return [...record.ems.keys()];
}

function gradeBit(value: bigint) {
    return Number(value);
}

const PRIMARY_BITS = [4290837504, 64512, 32768, 16384, 8192].map(BigInt);
const JUNIOR_BITS = [65536, 262144, 131072, 262144, 458752].map(BigInt);
const SENIOR_BITS = [524288, 1048576, 2097152].map(BigInt);

function inBits(grades: bigint, bits: bigint[]) {
    return bits.some((bit) => grades === bit);
}

function distance(groupA: OierRecord[], groupB: OierRecord[]): number {
    if (!groupA.length || !groupB.length) return INF;
    const years = [...groupA, ...groupB].map((r) => r.contest.year);
    if (Math.max(...years) - Math.min(...years) > 9) return INF;

    let coeff = 1;
    const changePrimary = new Set<number>();
    const changeJunior = new Set<number>();
    const changeSenior = new Set<number>();

    for (const a of groupA) {
        for (const b of groupB) {
            if (a.contest === b.contest) return INF;
            if (Math.abs(a.gender - b.gender) === 2) return INF;
            const yearA = schoolYear(a.contest);
            const yearB = schoolYear(b.contest);
            const yearDiff = Math.abs(yearA - yearB);
            const [earlier, later] = yearA <= yearB ? [a, b] : [b, a];
            const earlierGrade = gradeBit(earlier.grades);
            const laterGrade = gradeBit(later.grades);
            const juniorFirst = Number(JUNIOR_BITS[0]);
            const seniorFirst = Number(SENIOR_BITS[0]);
            if (
                yearDiff === 1
                && ((earlierGrade === juniorFirst && laterGrade === seniorFirst)
                    || (earlierGrade === seniorFirst && laterGrade === juniorFirst))
            ) return INF;
            const sameStage = (inBits(a.grades, PRIMARY_BITS) && inBits(b.grades, PRIMARY_BITS))
                || (inBits(a.grades, JUNIOR_BITS) && inBits(b.grades, JUNIOR_BITS))
                || (inBits(a.grades, SENIOR_BITS) && inBits(b.grades, SENIOR_BITS));
            if (sameStage && a.province !== b.province) return INF;
            if (schoolYear(a.contest) === schoolYear(b.contest)) {
                const overlap = new Set(emKeys(a));
                if (![...emKeys(b)].some((k) => overlap.has(k))) return INF;
            }
            const fa = CONTEST_TYPE_FAMILY[a.contest.type];
            const fb = CONTEST_TYPE_FAMILY[b.contest.type];
            if (fa && fb && fa === fb && a.school.id !== b.school.id) return INF;
            if (
                schoolYear(a.contest) < schoolYear(b.contest)
                && ['高中', '中学', '高级'].some((w) => a.school.name.includes(w))
                && !a.school.name.includes('小学')
                && b.school.name.includes('小学')
            ) return INF;
            const seniorLast = Number(SENIOR_BITS[SENIOR_BITS.length - 1]);
            if (
                ((gradeBit(a.grades) === seniorLast && gradeBit(b.grades) === juniorFirst)
                    || (gradeBit(a.grades) === juniorFirst && gradeBit(b.grades) === seniorLast))
                && a.province !== b.province
            ) coeff = Math.max(coeff, 3);
            if (inBits(a.grades, PRIMARY_BITS)) changePrimary.add(a.school.id);
            if (inBits(a.grades, JUNIOR_BITS)) changeJunior.add(a.school.id);
            if (inBits(a.grades, SENIOR_BITS)) changeSenior.add(a.school.id);
            if (inBits(b.grades, PRIMARY_BITS)) changePrimary.add(b.school.id);
            if (inBits(b.grades, JUNIOR_BITS)) changeJunior.add(b.school.id);
            if (inBits(b.grades, SENIOR_BITS)) changeSenior.add(b.school.id);
        }
    }

    const schools = new Set([...groupA, ...groupB].map((r) => r.school.id));
    const locations = new Set([...groupA, ...groupB].map(locationOf));
    const provinces = new Set([...groupA, ...groupB].map((r) => r.province));
    const aem = weightedMode(groupA.map((r) => r.ems));
    const bem = weightedMode(groupB.map((r) => r.ems));
    let diff = Infinity;
    for (const i of aem) for (const j of bem) diff = Math.min(diff, Math.abs(i - j));
    if (!Number.isFinite(diff)) diff = 0;

    if (changePrimary.size >= 3 || changeJunior.size >= 3 || changeSenior.size >= 3) {
        coeff = Math.max(coeff, 5);
    }

    return (
        ((SCHOOL_PENALTY[schools.size] ?? 600)
            + 80 * (locations.size + provinces.size - 3)
            + 100 * diff)
        * coeff
    );
}

function checkStayDown(groupA: OierRecord[], groupB: OierRecord[]): 0 | 1 | -1 {
    if (groupA.length <= 1 || groupB.length <= 1) return 0;
    const emsA = new Set(groupA.flatMap(emKeys));
    const emsB = new Set(groupB.flatMap(emKeys));
    if (emsA.size !== 1 || emsB.size !== 1) return 0;
    const aem = [...emsA][0];
    const bem = [...emsB][0];
    if (Math.abs(aem - bem) !== 1) return 0;
    const schools = new Set([...groupA, ...groupB].map((r) => r.school.id));
    const locations = new Set([...groupA, ...groupB].map(locationOf));
    const provinces = new Set([...groupA, ...groupB].map((r) => r.province));
    const penalty = (SCHOOL_PENALTY[schools.size] ?? 600) + 80 * (locations.size + provinces.size - 3);
    if (penalty >= 100) return 0;
    return (bem - aem) as 1 | -1;
}

function mergeGroups(records: OierRecord[]): OierRecord[][] {
    const groups: OierRecord[][] = records.map((record) => [record]);
    while (true) {
        let best = INF;
        let bi = -1;
        let bj = -1;
        for (let i = 0; i < groups.length; i++) {
            for (let j = 0; j < i; j++) {
                const dist = distance(groups[j], groups[i]);
                if (dist < best) {
                    best = dist;
                    bi = j;
                    bj = i;
                }
            }
        }
        if (best > MERGE_THRESHOLD || bi < 0 || bj < 0) break;
        const stay = checkStayDown(groups[bi], groups[bj]);
        if (stay === 1) for (const record of groups[bi]) record.keepGrade = true;
        else if (stay === -1) for (const record of groups[bj]) record.keepGrade = true;
        groups[bi].push(...groups[bj]);
        groups.splice(bj, 1);
    }
    return groups;
}

export function recordFingerprint(record: Pick<ParsedOierRecord, 'contestName' | 'award' | 'score' | 'rank' | 'school' | 'province'> & { name: string }): string {
    return [record.contestName, record.name, record.school, record.score ?? '', record.rank, record.award, record.province].join('|');
}

function toParsedRecord(record: OierRecord): ParsedOierRecord {
    const parsed: ParsedOierRecord = {
        contestName: record.contest.name,
        contestType: record.contest.type,
        year: record.contest.year,
        award: record.level,
        score: record.score,
        rank: record.rank,
        school: record.school.name,
        province: record.province,
        grade: record.gradeName,
        fingerprint: '',
    };
    parsed.fingerprint = recordFingerprint({ ...parsed, name: record.name });
    return parsed;
}

function latestSchoolOf(records: OierRecord[]): string {
    const latest = [...records].sort((a, b) => (
        b.contest.year - a.contest.year || b.contest.id - a.contest.id
    ))[0];
    return latest?.school.name || '';
}

export function attemptMerge(byKey: Map<string, OierRecord[]>): ParsedOier[] {
    const sequences: OierRecord[][] = [];
    for (const records of byKey.values()) {
        const identifier = records[0]?.identifier || '';
        if (identifier) sequences.push(records);
        else sequences.push(...mergeGroups(records));
    }
    return sequences.map((records) => {
        const original = records[0];
        const id = Math.min(...records.map((r) => r.id));
        const emSource = records.filter((r) => !r.keepGrade);
        const em = weightedMode((emSource.length ? emSource : records).map((r) => r.ems))[0] || 0;
        const genders = new Set(records.map((r) => r.gender).filter((g) => g));
        const gender = genders.size === 1 ? [...genders][0] : 0;
        const { ccfLevel, ccfScore } = computeCcf(records);
        const schools = [...new Set(records.map((r) => r.school.name))];
        return {
            id,
            name: original.name,
            identifier: original.identifier,
            gender,
            enrollMiddle: em,
            ccfLevel,
            ccfScore,
            schools,
            latestSchool: latestSchoolOf(records),
            records: records
                .map(toParsedRecord)
                .sort((a, b) => b.year - a.year || a.contestName.localeCompare(b.contestName)),
        };
    });
}
