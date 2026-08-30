import type { OierSchool } from './types';

const MIN_CONTAINMENT_LEN = 4;

export interface SchoolAliasIndex {
    canonicalByAlias: Map<string, string>;
    canonicalNames: string[];
}

export function normalizeSchoolName(name: string): string {
    return name.replace(/\s+/g, '').trim();
}

export function buildSchoolAliasIndex(schools: Pick<OierSchool, 'name' | 'aliases'>[]): SchoolAliasIndex {
    const canonicalByAlias = new Map<string, string>();
    const canonicalNames: string[] = [];
    const seen = new Set<string>();
    for (const school of schools) {
        const canon = normalizeSchoolName(school.name) || school.name;
        if (canon) {
            canonicalByAlias.set(canon, canon);
            if (!seen.has(canon)) {
                seen.add(canon);
                canonicalNames.push(canon);
            }
        }
        for (const alias of school.aliases || []) {
            const key = normalizeSchoolName(alias);
            if (key) canonicalByAlias.set(key, canon);
        }
    }
    return { canonicalByAlias, canonicalNames };
}

export function canonicalSchoolName(name: string, index: SchoolAliasIndex): string {
    const normalized = normalizeSchoolName(name);
    return index.canonicalByAlias.get(normalized) || normalized;
}

/** Resolve to a canonical school when the name uniquely contains or is contained by exactly one official name. */
export function uniqueContainmentCanonical(name: string, index: SchoolAliasIndex): string | null {
    const n = normalizeSchoolName(name);
    if (!n || n.length < MIN_CONTAINMENT_LEN) return null;
    let hit: string | null = null;
    for (const canon of index.canonicalNames) {
        if (!canon) continue;
        const contained = canon === n
            || (n.length >= MIN_CONTAINMENT_LEN && canon.includes(n))
            || (canon.length >= MIN_CONTAINMENT_LEN && n.includes(canon));
        if (!contained) continue;
        if (hit && hit !== canon) return null;
        hit = canon;
    }
    return hit;
}

export function resolvedSchoolName(name: string, index: SchoolAliasIndex): string {
    const normalized = normalizeSchoolName(name);
    if (!normalized) return '';
    return index.canonicalByAlias.get(normalized)
        || uniqueContainmentCanonical(normalized, index)
        || normalized;
}

export function schoolsMatch(a: string, b: string, index: SchoolAliasIndex): boolean {
    const na = normalizeSchoolName(a);
    const nb = normalizeSchoolName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ra = resolvedSchoolName(a, index);
    const rb = resolvedSchoolName(b, index);
    return !!ra && ra === rb;
}
