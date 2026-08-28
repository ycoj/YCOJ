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

export class BulkSubmitDuplicateZipPathError extends Error {
    constructor(public path: string) {
        super(`Duplicate zip path: ${path}`);
        this.name = 'BulkSubmitDuplicateZipPathError';
    }
}

export const SKIP_JUNK = 'Ignored junk file';
export const SKIP_NOT_CPP = 'Not a C++ file';
export const SKIP_LAYOUT = 'Unexpected path layout';
export const SKIP_NAME_MISMATCH = 'Filename does not match problem folder';
export const SKIP_UNMAPPED = 'Problem folder is not in mapping';
export const SKIP_DUPLICATE = 'Duplicate submission for this contestant and problem';
export const SKIP_PROBLEM_NOT_FOUND = 'Problem not found';
export const SKIP_LANG = 'This language is not allowed to submit.';
export const SKIP_EMPTY = 'Empty source file';
export const SKIP_TOO_LONG = 'Source file too long';
export const SKIP_READ = 'Failed to read file';
export const SKIP_SUBMIT = 'Submit failed';

export type BulkSubmitExistingUserPolicy = 'vuser' | 'existing';
export const DEFAULT_BULK_SUBMIT_EXISTING_USER_POLICY: BulkSubmitExistingUserPolicy = 'existing';

export const BULK_SUBMIT_ZIP_MODES = ['auto', 'subfolder', 'nosubfolder'] as const;
export type BulkSubmitZipMode = typeof BULK_SUBMIT_ZIP_MODES[number];

export function problemAllowsLang(pdoc: { config?: any }, lang: string) {
    const config = pdoc?.config;
    if (typeof config !== 'object' || !config) return false;
    if (['submit_answer', 'objective'].includes(config.type)) return false;
    if (config.langs && !config.langs.includes(lang)) return false;
    return true;
}

export interface BulkSubmitIdentity {
    kind: 'vuser' | 'user';
    uid: number;
    created: boolean;
    realUid?: number;
}

export interface BulkSubmitUser extends BulkSubmitIdentity {
    uname: string;
}

export interface PreparedBulkSubmit {
    uname: string;
    pid: number;
    problemName: string;
    code: string;
}

export interface InspectBulkSubmitResult {
    ready: PreparedBulkSubmit[];
    skipped: ZipLayoutSkip[];
    usersPreview: BulkSubmitUser[];
}

export function decideBulkSubmitIdentity(
    real: { _id: number } | null,
    vuser: { _id: number } | null,
    policy: BulkSubmitExistingUserPolicy,
): BulkSubmitIdentity {
    const vuserIdentity = (): BulkSubmitIdentity => {
        const base: BulkSubmitIdentity = vuser
            ? { kind: 'vuser', uid: vuser._id, created: false }
            : { kind: 'vuser', uid: 0, created: true };
        if (real) base.realUid = real._id;
        return base;
    };
    switch (policy) {
        case 'existing':
            if (real) return { kind: 'user', uid: real._id, created: false };
            return vuserIdentity();
        case 'vuser':
            return vuserIdentity();
        default: {
            const _exhaustive: never = policy;
            throw new Error(`Unknown existingUser policy: ${_exhaustive}`);
        }
    }
}

export function isCppLang(lang: string) {
    return lang === 'cc' || lang.startsWith('cc.');
}

export function pickDefaultCppLang(langs: string[]) {
    return langs.find((l) => l === 'cc.cc14o2') || langs[0];
}

export function buildBulkSubmitMappingDefaults(
    pids: number[],
    pdict: Record<number, { config?: any } | undefined>,
    fallbacks: string[],
) {
    const result: Record<number, string> = {};
    const usedFileIoNames = new Set<string>();
    for (let i = 0; i < pids.length; i++) {
        const pid = pids[i];
        const config = pdict[pid]?.config;
        const fileIoName = config?.type === 'default' && typeof config.subType === 'string'
            ? config.subType.trim()
            : '';
        if (!fileIoName) {
            result[pid] = fallbacks[i] || '';
            continue;
        }
        const normalized = fileIoName.toLowerCase();
        result[pid] = usedFileIoNames.has(normalized) ? '' : fileIoName;
        usedFileIoNames.add(normalized);
    }
    return result;
}

export function normalizeZipPath(filename: string) {
    return filename.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

export function indexZipEntriesByNormalizedPath<T extends { filename: string }>(entries: T[]): Map<string, T> {
    const map = new Map<string, T>();
    for (const entry of entries) {
        const path = normalizeZipPath(entry.filename);
        if (map.has(path)) throw new BulkSubmitDuplicateZipPathError(path);
        map.set(path, entry);
    }
    return map;
}

function basename(path: string) {
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
}

function isJunkPath(path: string) {
    const parts = path.split('/').filter(Boolean);
    if (parts.includes('__MACOSX')) return true;
    const base = parts[parts.length - 1] || '';
    return base === '.DS_Store' || base.startsWith('._');
}

function skip(path: string, reason: string, extra: Partial<ZipLayoutSkip> = {}): ZipLayoutSkip {
    const parts = normalizeZipPath(path).split('/').filter(Boolean);
    const filename = parts[parts.length - 1] || '';
    const stem = filename.replace(/\.cpp$/i, '');
    let uname = '';
    let problem = '';
    if (parts.length >= 3) {
        uname = parts[parts.length - 3] || '';
        problem = parts[parts.length - 2] || '';
    } else if (parts.length === 2) {
        uname = parts[0] || '';
        problem = stem !== filename ? stem : '';
    } else {
        uname = parts[0] || '';
    }
    return {
        uname: extra.uname ?? uname,
        problem: extra.problem ?? problem,
        reason,
    };
}

function isCppFilename(filename: string) {
    return /\.cpp$/i.test(filename);
}

function cppStem(filename: string) {
    return filename.replace(/\.cpp$/i, '');
}

function isSubfolderSignature(parts: string[]) {
    if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
    if (!isCppFilename(parts[2])) return false;
    return cppStem(parts[2]).toLowerCase() === parts[1].toLowerCase();
}

function sharedFirstDir(partsList: string[][]) {
    return partsList.length > 0 && partsList.every((parts) => parts[0] && parts[0] === partsList[0][0]);
}

type ClassifiedEntry =
    | { kind: 'file', file: ZipSourceFile }
    | { kind: 'skip', skip: ZipLayoutSkip }
    | { kind: 'other' };

function classifySubfolder(original: string, parts: string[]): ClassifiedEntry {
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return { kind: 'other' };
    const [contestantRaw, problemName, filename] = parts;
    const contestant = contestantRaw.trim();
    if (!contestant) {
        return { kind: 'skip', skip: skip(original, SKIP_LAYOUT, { uname: '', problem: problemName }) };
    }
    if (!isCppFilename(filename)) {
        return { kind: 'skip', skip: skip(original, SKIP_NOT_CPP, { uname: contestant, problem: problemName }) };
    }
    const stem = cppStem(filename);
    if (!stem || stem.toLowerCase() !== problemName.toLowerCase()) {
        return { kind: 'skip', skip: skip(original, SKIP_NAME_MISMATCH, { uname: contestant, problem: problemName }) };
    }
    return { kind: 'file', file: { path: original, contestant, problemName } };
}

function classifyNosubfolder(original: string, parts: string[]): ClassifiedEntry {
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { kind: 'other' };
    const [contestantRaw, filename] = parts;
    const contestant = contestantRaw.trim();
    if (!contestant) {
        return { kind: 'skip', skip: skip(original, SKIP_LAYOUT, { uname: '', problem: '' }) };
    }
    if (!isCppFilename(filename)) {
        return { kind: 'skip', skip: skip(original, SKIP_NOT_CPP, { uname: contestant, problem: cppStem(filename) }) };
    }
    const problemName = cppStem(filename);
    if (!problemName) {
        return { kind: 'skip', skip: skip(original, SKIP_LAYOUT, { uname: contestant, problem: '' }) };
    }
    return { kind: 'file', file: { path: original, contestant, problemName } };
}

function layoutSkip(original: string, parts: string[]): ZipLayoutSkip {
    return skip(original, SKIP_LAYOUT, { uname: parts[0] || '', problem: parts[1] || '' });
}

function parseWithStrip(
    candidates: { original: string, path: string }[],
    strip: number,
    mode: BulkSubmitZipMode,
): ZipLayoutResult {
    const skipped: ZipLayoutSkip[] = [];
    const subfolderFiles: ZipSourceFile[] = [];
    const nosubfolderFiles: ZipSourceFile[] = [];
    for (const item of candidates) {
        const parts = item.path.split('/').filter(Boolean).slice(strip);
        const original = item.original;
        switch (mode) {
            case 'subfolder': {
                const result = classifySubfolder(original, parts);
                if (result.kind === 'file') subfolderFiles.push(result.file);
                else if (result.kind === 'skip') skipped.push(result.skip);
                else skipped.push(layoutSkip(original, parts));
                break;
            }
            case 'nosubfolder': {
                const result = classifyNosubfolder(original, parts);
                if (result.kind === 'file') nosubfolderFiles.push(result.file);
                else if (result.kind === 'skip') skipped.push(result.skip);
                else skipped.push(layoutSkip(original, parts));
                break;
            }
            case 'auto': {
                const nested = classifySubfolder(original, parts);
                if (nested.kind === 'file') {
                    subfolderFiles.push(nested.file);
                    break;
                }
                if (nested.kind === 'skip') {
                    skipped.push(nested.skip);
                    break;
                }
                const flat = classifyNosubfolder(original, parts);
                if (flat.kind === 'file') nosubfolderFiles.push(flat.file);
                else if (flat.kind === 'skip') skipped.push(flat.skip);
                else skipped.push(layoutSkip(original, parts));
                break;
            }
            default: {
                const _exhaustive: never = mode;
                throw new Error(`Unknown zip mode: ${_exhaustive}`);
            }
        }
    }
    return { files: [...subfolderFiles, ...nosubfolderFiles], skipped };
}

function shouldStripWrapper(partsList: string[][], mode: Exclude<BulkSubmitZipMode, 'auto'>) {
    // Non-source files are skipped per entry and must not affect wrapper detection.
    const sourcePartsList = partsList.filter((parts) => isCppFilename(parts[parts.length - 1] || ''));
    if (!sharedFirstDir(sourcePartsList)) return false;
    switch (mode) {
        case 'subfolder':
            return sourcePartsList.length > 0 && sourcePartsList.every((parts) => parts.length >= 4);
        case 'nosubfolder':
            return sourcePartsList.length > 0
                && sourcePartsList.every((parts) => parts.length >= 3)
                && !sourcePartsList.every((parts) => isSubfolderSignature(parts));
        default: {
            const _exhaustive: never = mode;
            throw new Error(`Unknown zip mode: ${_exhaustive}`);
        }
    }
}

export function parseContestBulkSubmitPaths(
    filenames: string[],
    mode: BulkSubmitZipMode = 'auto',
): ZipLayoutResult {
    const items = filenames
        .map((original) => ({ original, path: normalizeZipPath(original) }))
        .filter((item) => item.path && !item.path.endsWith('/'));
    const skipped: ZipLayoutSkip[] = [];
    const candidates: { original: string, path: string }[] = [];
    for (const item of items) {
        if (isJunkPath(item.path)) {
            skipped.push(skip(item.original, SKIP_JUNK, { uname: '', problem: basename(item.path) }));
            continue;
        }
        candidates.push(item);
    }
    const partsList = candidates.map((item) => item.path.split('/').filter(Boolean));
    const sourcePartsList = partsList.filter((parts) => isCppFilename(parts[parts.length - 1] || ''));
    const noStrip = parseWithStrip(candidates, 0, mode);
    let chosen = noStrip;
    switch (mode) {
        case 'auto':
            if (sharedFirstDir(sourcePartsList)) {
                const stripped = parseWithStrip(candidates, 1, mode);
                if (stripped.files.length > noStrip.files.length) chosen = stripped;
            }
            break;
        case 'subfolder':
        case 'nosubfolder':
            if (shouldStripWrapper(partsList, mode)) chosen = parseWithStrip(candidates, 1, mode);
            break;
        default: {
            const _exhaustive: never = mode;
            throw new Error(`Unknown zip mode: ${_exhaustive}`);
        }
    }
    return { files: chosen.files, skipped: [...skipped, ...chosen.skipped] };
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
): { files: MappedZipFile[], skipped: ZipLayoutSkip[] } {
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
    const groups = new Map<string, { uname: string, files: MappedZipFile[] }>();
    for (const file of files) {
        const key = file.contestant.toLowerCase();
        const group = groups.get(key);
        if (!group) groups.set(key, { uname: file.contestant, files: [file] });
        else group.files.push(file);
    }
    return [...groups.values()];
}

export async function inspectContestBulkSubmit(opts: {
    groups: { uname: string, files: MappedZipFile[] }[];
    skipped: ZipLayoutSkip[];
    policy: BulkSubmitExistingUserPolicy;
    pdict: Record<number, { config?: any } | undefined>;
    submitLang: string;
    lengthLimit: number;
    lookupAccounts: (uname: string) => Promise<{ real: { _id: number } | null, vuser: { _id: number } | null }>;
    hasSource: (path: string) => boolean;
    readSource: (path: string) => Promise<string>;
    allowsLang: (pdoc: { config?: any }, lang: string) => boolean;
}): Promise<InspectBulkSubmitResult> {
    const skipped = [...opts.skipped];
    const ready: PreparedBulkSubmit[] = [];
    const usersPreview: BulkSubmitUser[] = [];
    for (const group of opts.groups) {
        // Account lookup is kept sequential to preserve preview ordering and limit backend fan-out.
        // eslint-disable-next-line no-await-in-loop
        const { real, vuser } = await opts.lookupAccounts(group.uname);
        usersPreview.push({ uname: group.uname, ...decideBulkSubmitIdentity(real, vuser, opts.policy) });
        for (const item of group.files) {
            const pdoc = opts.pdict[item.pid];
            if (!pdoc) {
                skipped.push({ uname: group.uname, problem: item.problemName, reason: SKIP_PROBLEM_NOT_FOUND });
                continue;
            }
            if (!opts.allowsLang(pdoc, opts.submitLang)) {
                skipped.push({ uname: group.uname, problem: item.problemName, reason: SKIP_LANG });
                continue;
            }
            if (!opts.hasSource(normalizeZipPath(item.path)) && !opts.hasSource(item.path)) {
                skipped.push({ uname: group.uname, problem: item.problemName, reason: SKIP_LAYOUT });
                continue;
            }
            let code = '';
            try {
                // Read each source in input order so skipped and ready entries remain deterministic.
                // eslint-disable-next-line no-await-in-loop
                code = await opts.readSource(item.path);
            } catch (e) {
                skipped.push({ uname: group.uname, problem: item.problemName, reason: e.message || SKIP_READ });
                continue;
            }
            if (!code.trim()) {
                skipped.push({ uname: group.uname, problem: item.problemName, reason: SKIP_EMPTY });
                continue;
            }
            if (code.length > opts.lengthLimit) {
                skipped.push({ uname: group.uname, problem: item.problemName, reason: SKIP_TOO_LONG });
                continue;
            }
            ready.push({
                uname: group.uname, pid: item.pid, problemName: item.problemName, code,
            });
        }
    }
    return { ready, skipped, usersPreview };
}

export function dryrunSubmittedFromInspect(inspect: InspectBulkSubmitResult) {
    const uidByUname = new Map(inspect.usersPreview.map((u) => [u.uname, u.uid]));
    return inspect.ready.map((item) => ({
        uname: item.uname,
        uid: uidByUname.get(item.uname) ?? 0,
        pid: item.pid,
    }));
}
