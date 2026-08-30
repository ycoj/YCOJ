import { resolvedSchoolName, type SchoolAliasIndex } from './schoolMatch';

export type BindReject = 'missing' | 'already' | 'mismatch' | 'taken';

export interface BindOier {
    name: string;
    uid?: number;
    schools?: string[];
    latestSchool?: string;
}

const EMPTY_SCHOOL_INDEX: SchoolAliasIndex = { canonicalByAlias: new Map(), canonicalNames: [] };

function schoolNamesOf(oier: BindOier): string[] {
    const names = [...(oier.schools || [])];
    if (oier.latestSchool) names.push(oier.latestSchool);
    return names;
}

export function schoolsMatchCanonical(
    oier: BindOier,
    school: string,
    index: SchoolAliasIndex = EMPTY_SCHOOL_INDEX,
): boolean {
    const want = resolvedSchoolName(school, index);
    if (!want) return false;
    return schoolNamesOf(oier).some((name) => name && resolvedSchoolName(name, index) === want);
}

export function checkBind(
    oier: BindOier | null,
    realName: string,
    school: string,
    userOierId?: number | null,
    index: SchoolAliasIndex = EMPTY_SCHOOL_INDEX,
): BindReject | null {
    if (!oier) return 'missing';
    if (userOierId) return 'already';
    if (oier.name !== realName || !schoolsMatchCanonical(oier, school, index)) return 'mismatch';
    if (oier.uid) return 'taken';
    return null;
}
