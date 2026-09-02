/* eslint-disable no-await-in-loop */
import { Collection, Filter, ObjectId } from 'mongodb';
import type { Context } from '../context';
import {
    AwardAlreadyBoundError, AwardNameMismatchError, AwardNotBoundError, AwardOierNotFoundError,
    AwardOierTakenError, AwardRealnameRequiredError, ValidationError,
} from '../error';
import {
    buildSchoolAliasIndex, checkBind, schoolsMatchCanonical, type BindReject, type ParseResult,
    type SchoolAliasIndex,
} from '../lib/oier';
import { isRealnameVerified } from '../lib/realname';
import db from '../service/db';
import user from './user';

export interface OierDoc {
    _id: number;
    name: string;
    ccfLevel: number;
    ccfScore: number;
    schools: string[];
    latestSchool: string;
    recordCount: number;
    uid?: number;
}

export interface OierRecordDoc {
    _id: ObjectId;
    oierId: number;
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

export interface OierSchoolDoc {
    _id: number;
    name: string;
    province: string;
    city: string;
    aliases: string[];
}

export interface OierContestDoc {
    _id: number;
    name: string;
    type: string;
    year: number;
    fallSemester: boolean;
    fullScore: number;
    capacity?: number;
}

const BATCH = 1000;
let coll = db.collection('oier');
let recordColl = db.collection('oier.record');
let schoolColl = db.collection('oier.school');
let contestColl = db.collection('oier.contest');
let aliasCache: SchoolAliasIndex | null = null;

export function invalidateSchoolCache() {
    aliasCache = null;
}

export async function getSchoolAliasIndex(): Promise<SchoolAliasIndex> {
    if (aliasCache) return aliasCache;
    const schools = await schoolColl.find().project<Pick<OierSchoolDoc, 'name' | 'aliases'>>({ name: 1, aliases: 1 }).toArray();
    aliasCache = buildSchoolAliasIndex(schools);
    return aliasCache;
}

export function get(id: number) {
    return coll.findOne({ _id: id });
}

export function getByUid(uid: number) {
    return coll.findOne({ uid });
}

export function getRecords(oierId: number) {
    return recordColl.find({ oierId }).sort({ year: -1, contestName: 1 }).toArray();
}

export async function getRecordsByOierIds(ids: number[]) {
    const map: Record<number, OierRecordDoc[]> = {};
    if (!ids.length) return map;
    const recs = await recordColl.find({ oierId: { $in: ids } }).sort({ year: -1, contestName: 1 }).toArray();
    for (const rec of recs) {
        (map[rec.oierId] ||= []).push(rec);
    }
    return map;
}

async function insertBatches<T extends { _id: any }>(
    target: { insertMany: (docs: any[], opts?: { ordered?: boolean }) => Promise<unknown> },
    docs: T[],
) {
    for (let i = 0; i < docs.length; i += BATCH) {
        const chunk = docs.slice(i, i + BATCH);
        if (chunk.length) await target.insertMany(chunk as any[], { ordered: false });
    }
}

function isMissingCollection(e: unknown) {
    const err = e as { code?: number, codeName?: string } | null;
    return err?.code === 26 || err?.codeName === 'NamespaceNotFound';
}

async function dropCollectionByName(name: string) {
    try {
        await db.db.collection(name).drop();
    } catch (e) {
        if (!isMissingCollection(e)) throw e;
    }
}

async function collectionExists(name: string) {
    const found = await db.db.listCollections({ name }, { nameOnly: true }).toArray();
    return found.length > 0;
}

async function renameCollection(from: string, to: string) {
    await db.db.renameCollection(from, to, { dropTarget: true });
}

interface SwapJob<T extends { _id: any }> {
    dest: Collection<T>;
    docs: T[];
    liveName: string;
    stagingName: string;
    previousName: string;
}

async function ensureAwardIndexes(target: {
    oier: Collection<OierDoc>;
    record: Collection<OierRecordDoc>;
    school: Collection<OierSchoolDoc>;
    contest: Collection<OierContestDoc>;
}) {
    await db.ensureIndexes(
        target.oier,
        { key: { name: 1 }, name: 'name' },
        { key: { uid: 1 }, name: 'uid', unique: true, sparse: true },
    );
    await db.ensureIndexes(
        target.record,
        { key: { oierId: 1, year: -1 }, name: 'oier_year' },
        { key: { fingerprint: 1 }, name: 'fingerprint' },
    );
    await db.ensureIndexes(
        target.school,
        { key: { name: 1 }, name: 'name' },
    );
    await db.ensureIndexes(
        target.contest,
        { key: { name: 1 }, name: 'name', unique: true },
    );
}

async function createAwardIndexesAlways(target: {
    oier: Collection<OierDoc>;
    record: Collection<OierRecordDoc>;
    school: Collection<OierSchoolDoc>;
    contest: Collection<OierContestDoc>;
}) {
    await target.oier.createIndexes([
        { key: { name: 1 }, name: 'name' },
        { key: { uid: 1 }, name: 'uid', unique: true, sparse: true },
    ]);
    await target.record.createIndexes([
        { key: { oierId: 1, year: -1 }, name: 'oier_year' },
        { key: { fingerprint: 1 }, name: 'fingerprint' },
    ]);
    await target.school.createIndexes([
        { key: { name: 1 }, name: 'name' },
    ]);
    await target.contest.createIndexes([
        { key: { name: 1 }, name: 'name', unique: true },
    ]);
}

function assertReplaceable(parsed: ParseResult) {
    const contestNames = new Set<string>();
    for (const contest of parsed.contests) {
        if (!contest.name) continue;
        if (contestNames.has(contest.name)) throw new ValidationError('contests', contest.name, 'Duplicate contest name');
        contestNames.add(contest.name);
    }
    const oierIds = new Set<number>();
    for (const oier of parsed.oiers) {
        if (oierIds.has(oier.id)) throw new ValidationError('oiers', oier.id, 'Duplicate contestant id');
        oierIds.add(oier.id);
    }
}

const uidLocks = new Map<number, Promise<unknown>>();

async function withUidLock<T>(uid: number, fn: () => Promise<T>): Promise<T> {
    const prev = uidLocks.get(uid) || Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const chain = prev.catch(() => undefined).then(() => held);
    uidLocks.set(uid, chain);
    await prev.catch(() => undefined);
    try {
        return await fn();
    } finally {
        release();
        if (uidLocks.get(uid) === chain) uidLocks.delete(uid);
    }
}

function throwBindReject(reject: BindReject | null, oierId: number) {
    switch (reject) {
        case 'missing': throw new AwardOierNotFoundError(oierId);
        case 'already': throw new AwardAlreadyBoundError();
        case 'mismatch': throw new AwardNameMismatchError();
        case 'taken': throw new AwardOierTakenError();
        case null: return;
        default: {
            const exhaustive: never = reject;
            throw exhaustive;
        }
    }
}

function verifiedSchoolOf(udoc: any, fallback = '') {
    return udoc?.realnameSchool || udoc?.school || fallback;
}

interface BindingSnapshot {
    uid: number;
    oierId: number;
    realName: string;
    school: string;
    ccfLevel: number;
    oierBoundAt?: Date;
    fingerprints: string[];
}

async function snapshotBindings(): Promise<BindingSnapshot[]> {
    const bound = await coll.find({ uid: { $exists: true } }).project({ _id: 1, uid: 1, ccfLevel: 1 }).toArray();
    const result: BindingSnapshot[] = [];
    for (const oier of bound) {
        if (!oier.uid) continue;
        const udoc = await user.getById('system', oier.uid);
        const records = await recordColl.find({ oierId: oier._id }).project({ fingerprint: 1 }).toArray();
        result.push({
            uid: oier.uid,
            oierId: oier._id,
            realName: udoc?.realName || '',
            school: verifiedSchoolOf(udoc),
            ccfLevel: udoc?.ccfLevel ?? oier.ccfLevel,
            oierBoundAt: udoc?.oierBoundAt,
            fingerprints: records.map((r) => r.fingerprint),
        });
    }
    return result;
}

function rematchErrorMessage(e: unknown) {
    return e instanceof Error ? e.message : String(e);
}

async function rematchOne(snap: BindingSnapshot, report?: (data: any) => void): Promise<boolean> {
    if (!snap.fingerprints.length || !snap.realName) return false;
    const hits = await recordColl.find({ fingerprint: { $in: snap.fingerprints } }).toArray();
    const counts = new Map<number, number>();
    for (const hit of hits) counts.set(hit.oierId, (counts.get(hit.oierId) || 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [oierId] of ranked) {
        const oier = await get(oierId);
        if (!oier || oier.uid) continue;
        try {
            await bind(snap.uid, oierId, snap.realName, snap.school);
            return true;
        } catch (e) {
            report?.({ message: `Skipped contestant ${oierId} for uid ${snap.uid}: ${rematchErrorMessage(e)}` });
        }
    }
    return false;
}

async function rematchBindings(snapshots: BindingSnapshot[], report?: (data: any) => void) {
    if (!snapshots.length) return { restored: 0, dropped: 0 };
    for (const snap of snapshots) {
        try {
            await user.setById(snap.uid, { ccfLevel: 0 }, { oierId: '', oierBoundAt: '' });
        } catch (e) {
            report?.({ message: `Failed to clear uid ${snap.uid} before rematch: ${rematchErrorMessage(e)}` });
        }
    }
    let restored = 0;
    let dropped = 0;
    for (const snap of snapshots) {
        try {
            if (await rematchOne(snap, report)) restored++;
            else dropped++;
        } catch (e) {
            dropped++;
            report?.({ message: `Dropped uid ${snap.uid} during rematch: ${rematchErrorMessage(e)}` });
        }
    }
    report?.({ message: `Restored ${restored} award binding(s), dropped ${dropped}.` });
    return { restored, dropped };
}

function swapJobs<T extends { _id: any }>(dest: Collection<T>, docs: T[]): SwapJob<T> {
    const liveName = dest.collectionName;
    return {
        dest,
        docs,
        liveName,
        stagingName: `${liveName}.importing`,
        previousName: `${liveName}.previous`,
    };
}

async function writeStaging(jobs: SwapJob<any>[]) {
    for (const job of jobs) {
        await dropCollectionByName(job.stagingName);
        if (job.docs.length) await insertBatches(db.db.collection(job.stagingName), job.docs);
        else await db.db.createCollection(job.stagingName);
    }
}

async function rollbackSwap(jobs: SwapJob<any>[], swapped: SwapJob<any>[]) {
    for (const job of [...swapped].reverse()) {
        if (await collectionExists(job.liveName)) {
            await dropCollectionByName(job.stagingName);
            await renameCollection(job.liveName, job.stagingName);
        }
        if (await collectionExists(job.previousName)) {
            await renameCollection(job.previousName, job.liveName);
        }
    }
    for (const job of jobs) await dropCollectionByName(job.stagingName);
}

async function swapStagingToLive(jobs: SwapJob<any>[]) {
    const swapped: SwapJob<any>[] = [];
    try {
        for (const job of jobs) {
            if (await collectionExists(job.liveName)) {
                await renameCollection(job.liveName, job.previousName);
            }
            swapped.push(job);
            if (await collectionExists(job.stagingName)) {
                await renameCollection(job.stagingName, job.liveName);
            }
        }
    } catch (e) {
        await rollbackSwap(jobs, swapped);
        throw e;
    }
}

export async function replaceAll(parsed: ParseResult, report?: (data: any) => void, dryrun = false) {
    assertReplaceable(parsed);
    const snapshots = dryrun ? [] : await snapshotBindings();
    report?.({ message: `Parsed ${parsed.oiers.length} contestants, ${parsed.schools.length} schools, ${parsed.warnings.length} warning(s).` });
    if (dryrun) return { oiers: parsed.oiers.length, warnings: parsed.warnings.length, dryrun: true };
    const oiers: OierDoc[] = parsed.oiers.map((o) => ({
        _id: o.id,
        name: o.name,
        ccfLevel: o.ccfLevel,
        ccfScore: o.ccfScore,
        schools: o.schools,
        latestSchool: o.latestSchool,
        recordCount: o.records.length,
    }));
    const records: OierRecordDoc[] = parsed.oiers.flatMap((o) => o.records.map((r) => ({
        _id: new ObjectId(),
        oierId: o.id,
        contestName: r.contestName,
        contestType: r.contestType,
        year: r.year,
        award: r.award,
        score: r.score,
        rank: r.rank,
        school: r.school,
        province: r.province,
        grade: r.grade,
        fingerprint: r.fingerprint,
    })));
    const schools: OierSchoolDoc[] = parsed.schools.map((s) => ({
        _id: s.id,
        name: s.name,
        province: s.province,
        city: s.city,
        aliases: s.aliases,
    }));
    const contests: OierContestDoc[] = parsed.contests.map((c) => ({
        _id: c.id,
        name: c.name,
        type: c.type,
        year: c.year,
        fallSemester: c.fallSemester,
        fullScore: c.fullScore,
        ...(c.capacity !== undefined ? { capacity: c.capacity } : {}),
    }));
    const jobs = [
        swapJobs(schoolColl, schools),
        swapJobs(contestColl, contests),
        swapJobs(coll, oiers),
        swapJobs(recordColl, records),
    ];
    try {
        await writeStaging(jobs);
        await createAwardIndexesAlways({
            school: db.db.collection(jobs[0].stagingName),
            contest: db.db.collection(jobs[1].stagingName),
            oier: db.db.collection(jobs[2].stagingName),
            record: db.db.collection(jobs[3].stagingName),
        });
    } catch (e) {
        for (const job of jobs) await dropCollectionByName(job.stagingName);
        throw e;
    }
    await swapStagingToLive(jobs);
    invalidateSchoolCache();
    report?.({ message: `Wrote ${oiers.length} contestants and ${records.length} records.` });
    try {
        await rematchBindings(snapshots, report);
    } catch (e) {
        report?.({ message: `Binding rematch failed: ${rematchErrorMessage(e)}` });
    }
    for (const job of jobs) await dropCollectionByName(job.previousName);
    return {
        oiers: oiers.length,
        records: records.length,
        schools: schools.length,
        contests: contests.length,
        warnings: parsed.warnings.length,
    };
}

export async function bind(uid: number, oierId: number, realName: string, school: string) {
    return withUidLock(uid, async () => {
        const index = await getSchoolAliasIndex();
        const oier = await get(oierId);
        const udoc = await user.getById('system', uid);
        if (!isRealnameVerified(udoc) || !udoc?.realName) throw new AwardRealnameRequiredError();
        throwBindReject(checkBind(oier, realName, school, udoc.oierId, index), oierId);
        const claimed = await coll.findOneAndUpdate(
            { _id: oierId, uid: { $exists: false } },
            { $set: { uid } },
            { returnDocument: 'after' },
        );
        if (!claimed) throw new AwardOierTakenError();
        try {
            const fresh = await user.getById('system', uid);
            if (!isRealnameVerified(fresh) || !fresh?.realName) throw new AwardRealnameRequiredError();
            throwBindReject(
                checkBind(
                    { name: claimed.name, schools: claimed.schools, latestSchool: claimed.latestSchool },
                    fresh.realName,
                    verifiedSchoolOf(fresh, school),
                    fresh.oierId,
                    index,
                ),
                oierId,
            );
            await user.setById(uid, { oierId, oierBoundAt: new Date(), ccfLevel: claimed.ccfLevel });
        } catch (e) {
            await coll.updateOne({ _id: oierId, uid }, { $unset: { uid: '' } });
            throw e;
        }
        return claimed;
    });
}

export async function restoreUidIfUnbound(oierId: number, uid: number) {
    await coll.updateOne({ _id: oierId, uid: { $exists: false } }, { $set: { uid } });
}

export async function unbindByUid(uid: number) {
    return withUidLock(uid, async () => {
        const udoc = await user.coll.findOne({ _id: uid }, { projection: { oierId: 1 } });
        if (!udoc?.oierId) throw new AwardNotBoundError();
        const oierId = udoc.oierId;
        const released = await coll.findOneAndUpdate(
            { _id: oierId, uid },
            { $unset: { uid: '' } },
            { returnDocument: 'before' },
        );
        try {
            await user.setById(uid, { ccfLevel: 0 }, { oierId: '', oierBoundAt: '' });
        } catch (e) {
            if (released) await restoreUidIfUnbound(oierId, uid);
            throw e;
        }
    });
}

export interface CandidateQuery {
    name: string;
    school: string;
    others: boolean;
    page: number;
    pageSize: number;
}

export async function findCandidates(query: CandidateQuery) {
    const index = await getSchoolAliasIndex();
    const all = await coll.find({ name: query.name }).sort({ ccfLevel: -1, _id: 1 }).toArray();
    const preferred = all.filter((o) => schoolsMatchCanonical(o, query.school, index));
    const rest = all.filter((o) => !schoolsMatchCanonical(o, query.school, index));
    const showingOthers = query.others || !preferred.length;
    const list = showingOthers ? [...preferred, ...rest] : preferred;
    const start = (query.page - 1) * query.pageSize;
    return {
        docs: list.slice(start, start + query.pageSize),
        count: list.length,
        numPages: Math.max(1, Math.ceil(list.length / query.pageSize)),
        preferredCount: preferred.length,
        othersCount: rest.length,
        showingOthers,
    };
}

export async function paginateBound(
    filter: { uid?: Filter<OierDoc>['uid'] },
    page: number,
    pageSize: number,
) {
    const q: Filter<OierDoc> = filter.uid ? { uid: filter.uid } : { uid: { $exists: true } };
    const count = await coll.countDocuments(q);
    const docs = await coll.find(q).sort({ uid: 1 }).skip((page - 1) * pageSize).limit(pageSize).toArray();
    return [docs, Math.max(1, Math.ceil(count / pageSize)), count] as const;
}

export async function apply(ctx: Context) {
    coll = ctx.db.collection('oier');
    recordColl = ctx.db.collection('oier.record');
    schoolColl = ctx.db.collection('oier.school');
    contestColl = ctx.db.collection('oier.contest');
    await ensureAwardIndexes({
        oier: coll,
        record: recordColl,
        school: schoolColl,
        contest: contestColl,
    });
    await ctx.db.ensureIndexes(
        user.coll,
        { key: { oierId: 1 }, name: 'oierId', unique: true, sparse: true },
    );
}

global.Hydro.model.oier = {
    bind,
    findCandidates,
    get,
    getByUid,
    getRecords,
    getRecordsByOierIds,
    getSchoolAliasIndex,
    invalidateSchoolCache,
    paginateBound,
    replaceAll,
    restoreUidIfUnbound,
    unbindByUid,
    apply,
};
