import type { OierSchool } from './types';

export interface SchoolAliasIndex {
    canonicalByAlias: Map<string, string>;
}

export function normalizeSchoolName(name: string): string {
    return name.replace(/\s+/g, '').trim();
}

export function buildSchoolAliasIndex(schools: Pick<OierSchool, 'name' | 'aliases'>[]): SchoolAliasIndex {
    const canonicalByAlias = new Map<string, string>();
    for (const school of schools) {
        const canon = normalizeSchoolName(school.name) || school.name;
        if (canon) canonicalByAlias.set(canon, canon);
        for (const alias of school.aliases || []) {
            const key = normalizeSchoolName(alias);
            if (key) canonicalByAlias.set(key, canon);
        }
    }
    return { canonicalByAlias };
}

export function canonicalSchoolName(name: string, index: SchoolAliasIndex): string {
    const normalized = normalizeSchoolName(name);
    return index.canonicalByAlias.get(normalized) || normalized;
}

function containsMatch(a: string, b: string) {
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    if (shorter.length < 4) return false;
    return longer.includes(shorter);
}

export function schoolsMatch(a: string, b: string, index: SchoolAliasIndex): boolean {
    const na = normalizeSchoolName(a);
    const nb = normalizeSchoolName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ca = canonicalSchoolName(a, index);
    const cb = canonicalSchoolName(b, index);
    if (ca && cb && ca === cb) return true;
    return containsMatch(na, nb) || containsMatch(ca, cb) || containsMatch(na, cb) || containsMatch(ca, nb);
}
