import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { FileEntry, TextWriter, ZipReader } from '@zip.js/zip.js';
import { ObjectId } from 'mongodb';
import { ValidationError } from '../../error';
import problem from '../../model/problem';
import system from '../../model/system';
import user from '../../model/user';
import { commitContestBulkSubmit } from './commit';
import {
    applyProblemMapping, BulkSubmitExistingUserPolicy, BulkSubmitZipMode, dryrunSubmittedFromInspect,
    groupByContestant, indexZipEntriesByNormalizedPath, inspectContestBulkSubmit, normalizeZipPath,
    parseContestBulkSubmitPaths, problemAllowsLang,
} from './inspect';

export async function processContestBulkSubmit(opts: {
    domainId: string;
    tid: ObjectId;
    pids: number[];
    beginAt: Date;
    filePath: string;
    mapping: Record<number, string>;
    submitLang: string;
    dryrun: boolean;
    existingUser: BulkSubmitExistingUserPolicy;
    zipMode: BulkSubmitZipMode;
}) {
    const zip = new ZipReader(Readable.toWeb(createReadStream(opts.filePath)));
    try {
        let fileEntries: FileEntry[];
        try {
            fileEntries = (await zip.getEntries()).filter((entry): entry is FileEntry => !!entry.filename && entry.directory !== true);
        } catch (e) {
            throw new ValidationError('file', null, e.message);
        }
        const maxZipEntries = 10000;
        const maxZipUncompressed = system.get('limit.contest_files_size') || 128 * 1024 * 1024;
        if (fileEntries.length > maxZipEntries) throw new ValidationError('file', null, 'Too many files in zip');
        let totalUncompressed = 0;
        for (const entry of fileEntries) {
            totalUncompressed += entry.uncompressedSize || 0;
            if (totalUncompressed > maxZipUncompressed) throw new ValidationError('file', null, 'Zip uncompressed size too large');
        }
        let entryByPath: Map<string, FileEntry>;
        try {
            entryByPath = indexZipEntriesByNormalizedPath(fileEntries);
        } catch (e) {
            throw new ValidationError('file', null, e.message);
        }
        const layout = parseContestBulkSubmitPaths(fileEntries.map((entry) => entry.filename), opts.zipMode);
        const mapped = applyProblemMapping(layout.files, opts.mapping);
        const pdict = await problem.getList(opts.domainId, opts.pids, true, true, problem.PROJECTION_CONTEST_LIST);
        const inspect = await inspectContestBulkSubmit({
            groups: groupByContestant(mapped.files),
            skipped: [...layout.skipped, ...mapped.skipped],
            policy: opts.existingUser,
            pdict,
            submitLang: opts.submitLang,
            lengthLimit: system.get('limit.codelength') || 128 * 1024,
            lookupAccounts: async (uname) => ({
                real: await user.getRealByUname(opts.domainId, uname),
                vuser: await user.getVuserByUname(uname),
            }),
            hasSource: (path) => entryByPath.has(normalizeZipPath(path)),
            readSource: async (path) => {
                const entry = entryByPath.get(normalizeZipPath(path));
                if (!entry) throw new Error('Unexpected path layout');
                return String(await entry.getData(new TextWriter())).replace(/\r\n/g, '\n');
            },
            allowsLang: problemAllowsLang,
        });
        if (opts.dryrun) {
            return {
                dryrun: true,
                lang: opts.submitLang,
                users: inspect.usersPreview,
                submitted: dryrunSubmittedFromInspect(inspect),
                skipped: inspect.skipped,
            };
        }
        return {
            dryrun: false,
            lang: opts.submitLang,
            ...(await commitContestBulkSubmit({
                domainId: opts.domainId,
                tid: opts.tid,
                beginAt: opts.beginAt,
                lang: opts.submitLang,
                ready: inspect.ready,
                usersPreview: inspect.usersPreview,
                skipped: inspect.skipped,
            })),
        };
    } finally {
        await zip.close().catch(() => { });
    }
}
