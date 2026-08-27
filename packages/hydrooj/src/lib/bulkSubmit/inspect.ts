export interface ZipSourceFile {
    path: string;
    contestant: string;
    problemName: string;
}

export interface ZipLayoutSkip {
    uname: string;
    problem: string;
    reason: string;
}

export interface ZipLayoutResult {
    files: ZipSourceFile[];
    skipped: ZipLayoutSkip[];
}

export interface MappedZipFile extends ZipSourceFile {
    pid: number;
}

export class BulkSubmitMappingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BulkSubmitMappingError';
    }
}

export const SKIP_JUNK = 'Ignored junk file';
export const SKIP_NOT_CPP = 'Not a C++ file';
export const SKIP_LAYOUT = 'Unexpected path layout';
export const SKIP_NAME_MISMATCH = 'Filename does not match problem folder';
export const SKIP_UNMAPPED = 'Problem folder is not in mapping';
export const SKIP_DUPLICATE = 'Duplicate submission for this contestant and problem';

export function isCppLang(lang: string) {
    return lang === 'cc' || lang.startsWith('cc.');
}

export function pickDefaultCppLang(langs: string[]) {
    return langs.find((l) => l === 'cc.cc14') || langs[0];
}

export function normalizeZipPath(filename: string) {
    return filename.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function basename(path: string) {
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
}

function isJunkPath(path: string) {
    const parts = path.split('/').filter(Boolean);
    if (parts.some((p) => p === '__MACOSX')) return true;
    const base = parts[parts.length - 1] || '';
    return base === '.DS_Store' || base.startsWith('._');
}

function skip(path: string, reason: string, extra: Partial<ZipLayoutSkip> = {}): ZipLayoutSkip {
    const parts = normalizeZipPath(path).split('/').filter(Boolean);
    return {
        uname: extra.uname ?? (parts.length >= 2 ? parts[parts.length - 3] || parts[0] : parts[0] || ''),
        problem: extra.problem ?? (parts.length >= 2 ? parts[parts.length - 2] || '' : ''),
        reason,
    };
}

export function parseContestBulkSubmitPaths(filenames: string[]): ZipLayoutResult {
    const items = filenames
        .map((original) => ({ original, path: normalizeZipPath(original) }))
        .filter((item) => item.path && !item.path.endsWith('/'));
    const skipped: ZipLayoutSkip[] = [];
    const candidates: { original: string; path: string }[] = [];
    for (const item of items) {
        if (isJunkPath(item.path)) {
            skipped.push(skip(item.original, SKIP_JUNK, { uname: '', problem: basename(item.path) }));
            continue;
        }
        candidates.push(item);
    }
    const partsList = candidates.map((item) => item.path.split('/').filter(Boolean));
    const strip = partsList.length
        && partsList.every((parts) => parts.length >= 4)
        && partsList.every((parts) => parts[0] === partsList[0][0])
        ? 1 : 0;
    const files: ZipSourceFile[] = [];
    for (let i = 0; i < candidates.length; i++) {
        const parts = partsList[i].slice(strip);
        const original = candidates[i].original;
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
            skipped.push(skip(original, SKIP_LAYOUT, { uname: parts[0] || '', problem: parts[1] || '' }));
            continue;
        }
        const [contestantRaw, problemName, filename] = parts;
        const contestant = contestantRaw.trim();
        if (!contestant) {
            skipped.push(skip(original, SKIP_LAYOUT, { uname: '', problem: problemName }));
            continue;
        }
        if (!/\.cpp$/i.test(filename)) {
            skipped.push(skip(original, SKIP_NOT_CPP, { uname: contestant, problem: problemName }));
            continue;
        }
        const stem = filename.replace(/\.cpp$/i, '');
        if (stem.toLowerCase() !== problemName.toLowerCase()) {
            skipped.push(skip(original, SKIP_NAME_MISMATCH, { uname: contestant, problem: problemName }));
            continue;
        }
        files.push({ path: original, contestant, problemName });
    }
    return { files, skipped };
}

export function parseProblemMapping(raw: unknown, contestPids: number[]): Record<number, string> {
    let obj = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        } catch {
            throw new BulkSubmitMappingError('Invalid mapping JSON');
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new BulkSubmitMappingError('Invalid mapping');
    }
    const mapping: Record<number, string> = {};
    const nameToPid = new Map<string, number>();
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const pid = Number(key);
        if (!Number.isSafeInteger(pid) || pid <= 0) {
            throw new BulkSubmitMappingError(`Invalid pid ${key}`);
        }
        if (!contestPids.includes(pid)) {
            throw new BulkSubmitMappingError(`pid ${pid} is not in this contest`);
        }
        if (value == null || value === '') continue;
        if (typeof value !== 'string' && typeof value !== 'number') {
            throw new BulkSubmitMappingError(`Invalid name for pid ${pid}`);
        }
        const name = String(value).trim();
        if (!name) continue;
        const normalized = name.toLowerCase();
        const existing = nameToPid.get(normalized);
        if (existing != null && existing !== pid) {
            throw new BulkSubmitMappingError(`Duplicate folder name ${name}`);
        }
        nameToPid.set(normalized, pid);
        mapping[pid] = name;
    }
    if (!Object.keys(mapping).length) {
        throw new BulkSubmitMappingError('Empty mapping');
    }
    return mapping;
}

export function applyProblemMapping(
    files: ZipSourceFile[],
    mapping: Record<number, string>,
): { files: MappedZipFile[]; skipped: ZipLayoutSkip[] } {
    const nameToPid = new Map<string, number>();
    for (const [pid, name] of Object.entries(mapping)) {
        nameToPid.set(name.toLowerCase(), +pid);
    }
    const seen = new Set<string>();
    const mapped: MappedZipFile[] = [];
    const skipped: ZipLayoutSkip[] = [];
    for (const file of files) {
        const pid = nameToPid.get(file.problemName.toLowerCase());
        if (pid == null) {
            skipped.push({ uname: file.contestant, problem: file.problemName, reason: SKIP_UNMAPPED });
            continue;
        }
        const key = `${file.contestant.toLowerCase()}\0${pid}`;
        if (seen.has(key)) {
            skipped.push({ uname: file.contestant, problem: file.problemName, reason: SKIP_DUPLICATE });
            continue;
        }
        seen.add(key);
        mapped.push({ ...file, pid });
    }
    return { files: mapped, skipped };
}

export function groupByContestant(files: MappedZipFile[]) {
    const groups = new Map<string, { uname: string; files: MappedZipFile[] }>();
    for (const file of files) {
        const key = file.contestant.toLowerCase();
        const group = groups.get(key);
        if (!group) groups.set(key, { uname: file.contestant, files: [file] });
        else group.files.push(file);
    }
    return [...groups.values()];
}
