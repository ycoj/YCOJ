import { promises as fs } from 'fs';
import path from 'path';
import {
    AWARD_LEVELS, CONTEST_TYPES, GENDER_MAP, PROVINCES, SCORE_WITH_RANK,
} from './constants';
import { enrollmentMiddle, getGrades, parseGradesConfig } from './grades';
import { attemptMerge } from './merge';
import type {
    ContestSettings, GradesConfig, OierContestState, OierDataFiles, OierRecord, OierSchool,
    ParseResult, ParseWarning,
} from './types';

function isScoreValid(score: string) {
    if (SCORE_WITH_RANK.test(score) || score === '') return true;
    if (!score.replace('.', '').match(/^\d+$/)) return false;
    return Number.isFinite(Number(score));
}

function addContestant(contest: OierContestState, record: Omit<OierRecord, 'rank' | 'contest'>): OierRecord {
    const last = contest.contestants[contest.contestants.length - 1];
    let rank: number;
    if (record.score === null) rank = contest.contestants.length + 1;
    else if (!contest.contestants.length) rank = 1;
    else if (last && last.score === record.score) rank = last.rank;
    else rank = contest.contestants.length + 1;
    const full: OierRecord = { ...record, contest, rank };
    contest.contestants.push(full);
    contest.levelCounts.set(full.level, (contest.levelCounts.get(full.level) || 0) + 1);
    return full;
}

function parseScore(score: string): { score: number | null, rank?: number } {
    const matched = score.match(SCORE_WITH_RANK);
    if (matched) return { score: Number(matched[1]), rank: Number(matched[2]) };
    if (score === '') return { score: null };
    return { score: Number(score) };
}

function parseSchoolTxt(text: string, warnings: ParseWarning[]): OierSchool[] {
    const schools: OierSchool[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(',');
        if (parts.length < 3) {
            warnings.push({ file: 'school.txt', line: i + 1, message: '格式错误' });
            continue;
        }
        const [province, city, name, ...aliases] = parts;
        if ((province || city || name) && !PROVINCES.includes(province as typeof PROVINCES[number])) {
            warnings.push({ file: 'school.txt', line: i + 1, message: `未知的省级行政区：'${province}'` });
        }
        schools.push({
            id: schools.length,
            name,
            province,
            city,
            aliases,
        });
    }
    return schools;
}

function schoolLookups(schools: OierSchool[]) {
    const byName = new Map<string, OierSchool>();
    const byProvinceName = new Map<string, Map<string, OierSchool>>();
    const register = (key: string, school: OierSchool, province: string) => {
        if (!key) return;
        byName.set(key, school);
        if (!byProvinceName.has(province)) byProvinceName.set(province, new Map());
        byProvinceName.get(province)!.set(key, school);
    };
    for (const school of schools) {
        register(school.name, school, school.province);
        for (const alias of school.aliases) register(alias, school, school.province);
    }
    return {
        byNameInProvince(name: string, province: string) {
            const found = byProvinceName.get(province)?.get(name);
            if (found) return found;
            const slash = name.split('/')[0];
            if (slash !== name) {
                const alt = byProvinceName.get(province)?.get(slash);
                if (alt) return alt;
            }
            return byName.get(name) || byName.get(slash) || null;
        },
    };
}

function parseContests(json: string, warnings: ParseWarning[]): OierContestState[] {
    const list = JSON.parse(json) as ContestSettings[];
    const contests: OierContestState[] = [];
    const names = new Set<string>();
    for (const settings of list) {
        if (!CONTEST_TYPES.includes(settings.type as typeof CONTEST_TYPES[number])) {
            warnings.push({ file: 'contests.json', line: 0, message: `未知的比赛类型：'${settings.type}'（${settings.name}）` });
        }
        if (names.has(settings.name)) {
            warnings.push({ file: 'contests.json', line: 0, message: `重复的比赛名：'${settings.name}'` });
        }
        names.add(settings.name);
        contests.push({
            id: contests.length,
            name: settings.name,
            type: settings.type,
            year: settings.year,
            fallSemester: !!settings.fall_semester,
            fullScore: settings.full_score,
            capacity: settings.capacity,
            contestants: [],
            levelCounts: new Map(),
        });
    }
    return contests;
}

function parseRaw(
    text: string,
    contests: OierContestState[],
    schools: OierSchool[],
    gradesConfig: GradesConfig,
    warnings: ParseWarning[],
): Map<string, OierRecord[]> {
    const contestByName = new Map(contests.map((c) => [c.name, c]));
    const lookup = schoolLookups(schools);
    const byKey = new Map<string, OierRecord[]>();
    const lines = text.split(/\r?\n/);
    let nextId = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        const li = line.split(',');
        if (li.length !== 9) {
            warnings.push({ file: 'raw.txt', line: i + 1, message: '格式错误' });
            continue;
        }
        const [contestName, level, name, gradeName, schoolName, score, province, genderName, identifier] = li;
        if (!name) {
            warnings.push({ file: 'raw.txt', line: i + 1, message: '姓名不能为空' });
            continue;
        }
        if (!PROVINCES.includes(province as typeof PROVINCES[number])) {
            warnings.push({ file: 'raw.txt', line: i + 1, message: `未知的省级行政区：'${province}'` });
            continue;
        }
        if (!AWARD_LEVELS.includes(level as typeof AWARD_LEVELS[number])) {
            warnings.push({ file: 'raw.txt', line: i + 1, message: `未知的奖项名称：'${level}'` });
            continue;
        }
        const contest = contestByName.get(contestName);
        if (!contest) {
            warnings.push({ file: 'raw.txt', line: i + 1, message: `未知的比赛名：'${contestName}'` });
            continue;
        }
        const school = lookup.byNameInProvince(schoolName, province);
        if (!school) {
            warnings.push({ file: 'raw.txt', line: i + 1, message: `未知的学校名：'${schoolName}'（省份：${province}）` });
            continue;
        }
        if (!isScoreValid(score)) {
            warnings.push({ file: 'raw.txt', line: i + 1, message: `无法识别的分数：'${score}'` });
            continue;
        }
        let grades: bigint;
        try {
            grades = getGrades(gradeName, gradesConfig);
        } catch (e) {
            warnings.push({ file: 'raw.txt', line: i + 1, message: (e as Error).message });
            continue;
        }
        const parsedScore = parseScore(score);
        nextId += 1;
        const base = {
            id: nextId,
            name,
            identifier,
            score: parsedScore.score,
            level,
            grades,
            gradeName,
            school,
            province,
            gender: GENDER_MAP[genderName] || 0,
            ems: enrollmentMiddle(contest, grades),
            keepGrade: false,
        };
        let record: OierRecord;
        if (parsedScore.rank !== undefined) {
            record = { ...base, contest, rank: parsedScore.rank };
            contest.contestants.push(record);
            contest.levelCounts.set(record.level, (contest.levelCounts.get(record.level) || 0) + 1);
        } else {
            record = addContestant(contest, base);
        }
        const key = `${name}\0${identifier}`;
        const bucket = byKey.get(key) || [];
        bucket.push(record);
        byKey.set(key, bucket);
    }
    return byKey;
}

export function parseOierData(files: OierDataFiles): ParseResult {
    const warnings: ParseWarning[] = [];
    const gradesConfig = parseGradesConfig(files.gradesJson);
    const schools = parseSchoolTxt(files.schoolTxt, warnings);
    const contests = parseContests(files.contestsJson, warnings);
    const byKey = parseRaw(files.rawTxt, contests, schools, gradesConfig, warnings);
    const oiers = attemptMerge(byKey);
    return {
        schools,
        contests: contests.map(({ contestants, levelCounts, ...rest }) => rest),
        oiers,
        warnings,
    };
}

export async function loadOierDataDir(dataDir: string): Promise<OierDataFiles> {
    const read = (name: string) => fs.readFile(path.join(dataDir, name), 'utf8');
    const [schoolTxt, contestsJson, rawTxt, gradesJson] = await Promise.all([
        read('school.txt'),
        read('contests.json'),
        read('raw.txt'),
        read('grades.json').catch(() => undefined),
    ]);
    return { schoolTxt, contestsJson, rawTxt, gradesJson };
}
