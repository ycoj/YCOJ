export interface GradesConfig {
    initial: number;
    element: Record<string, number>;
    special: Record<string, number>;
}

export interface ContestSettings {
    name: string;
    type: string;
    year: number;
    fall_semester: boolean;
    full_score: number;
    capacity?: number;
}

export interface OierSchool {
    id: number;
    name: string;
    province: string;
    city: string;
    aliases: string[];
}

export interface OierContestState {
    id: number;
    name: string;
    type: string;
    year: number;
    fallSemester: boolean;
    fullScore: number;
    capacity?: number;
    contestants: OierRecord[];
    levelCounts: Map<string, number>;
}

export interface OierRecord {
    id: number;
    name: string;
    identifier: string;
    contest: OierContestState;
    score: number | null;
    rank: number;
    level: string;
    grades: bigint;
    gradeName: string;
    school: OierSchool;
    province: string;
    gender: number;
    ems: Map<number, number>;
    keepGrade: boolean;
}

export interface ParsedOierRecord {
    contestName: string;
    contestType: string;
    year: number;
    award: string;
    score: number | null;
    rank: number;
    school: string;
    province: string;
    grade: string;
    fingerprint: string;
}

export interface ParsedOier {
    id: number;
    name: string;
    identifier: string;
    gender: number;
    enrollMiddle: number;
    ccfLevel: number;
    ccfScore: number;
    schools: string[];
    latestSchool: string;
    records: ParsedOierRecord[];
}

export interface ParseWarning {
    file: string;
    line: number;
    message: string;
}

export interface ParseResult {
    schools: OierSchool[];
    contests: Omit<OierContestState, 'contestants' | 'levelCounts'>[];
    oiers: ParsedOier[];
    warnings: ParseWarning[];
}

export interface OierDataFiles {
    schoolTxt: string;
    contestsJson: string;
    rawTxt: string;
    gradesJson?: string;
}

export type CcfHookTier = 'green' | 'blue' | 'gold';
