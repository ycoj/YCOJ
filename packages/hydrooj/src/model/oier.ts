/* eslint-disable no-await-in-loop */
import { Filter, ObjectId } from 'mongodb';
import type { Context } from '../context';
import {
    AwardAlreadyBoundError, AwardNameMismatchError, AwardNotBoundError, AwardOierNotFoundError,
    AwardOierTakenError,
} from '../error';
import {
    buildSchoolAliasIndex, checkBind, schoolsMatch, type ParseResult, type SchoolAliasIndex,
} from '../lib/oier';
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

async function insertBatches<T extends { _id: any }>(target: ReturnType<typeof db.collection>, docs: T[]) {
    for (let i = 0; i < docs.length; i += BATCH) {
        const chunk = docs.slice(i, i + BATCH);
        if (chunk.length) await target.insertMany(chunk as any[], { ordered: false });
    }
}

interface BindingSnapshot {
    uid: number;
    realName: string;
    fingerprints: string[];
}

async function snapshotBindings(): Promise<BindingSnapshot[]> {
    const bound = await coll.find({ uid: { $exists: true } }).project({ _id: 1, uid: 1 }).toArray();
    const result: BindingSnapshot[] = [];
    for (const oier of bound) {
        if (!oier.uid) continue;
        const udoc = await user.getById('system', oier.uid);
        const records = await recordColl.find({ oierId: oier._id }).project({ fingerprint: 1 }).toArray();
        result.push({
            uid: oier.uid,
            realName: udoc?.realName || '',
            fingerprints: records.map((r) => r.fingerprint),
        });
    }
    return result;
}

async function rematchBindings(snapshots: BindingSnapshot[], report?: (data: any) => void) {
    if (!snapshots.length) return { restored: 0, dropped: 0 };
    for (const snap of snapshots) {
        await user.setById(snap.uid, { ccfLevel: 0 }, { oierId: '', oierBoundAt: '' });
    }
    let restored = 0;
    let dropped = 0;
    for (const snap of snapshots) {
        if (!snap.fingerprints.length || !snap.realName) {
            dropped++;
            continue;
        }
        const hits = await recordColl.find({ fingerprint: { $in: snap.fingerprints } }).toArray();
        const counts = new Map<number, number>();
        for (const hit of hits) counts.set(hit.oierId, (counts.get(hit.oierId) || 0) + 1);
        const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        let matched = false;
        for (const [oierId] of ranked) {
            const oier = await get(oierId);
            if (!oier || oier.name !== snap.realName || oier.uid) continue;
            await bind(snap.uid, oierId, snap.realName);
            restored++;
            matched = true;
            break;
        }
        if (!matched) dropped++;
    }
    report?.({ message: `Restored ${restored} award binding(s), dropped ${dropped}.` });
    return { restored, dropped };
}

export async function replaceAll(parsed: ParseResult, report?: (data: any) => void, dryrun = false) {
    const snapshots = dryrun ? [] : await snapshotBindings();
    report?.({ message: `Parsed ${parsed.oiers.length} contestants, ${parsed.schools.length} schools, ${parsed.warnings.length} warning(s).` });
    if (dryrun) return { oiers: parsed.oiers.length, warnings: parsed.warnings.length, dryrun: true };
    await Promise.all([
        coll.deleteMany({}),
        recordColl.deleteMany({}),
        schoolColl.deleteMany({}),
        contestColl.deleteMany({}),
    ]);
    invalidateSchoolCache();
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
    await insertBatches(schoolColl, schools);
    await insertBatches(contestColl, contests);
    await insertBatches(coll, oiers);
    await insertBatches(recordColl, records);
    report?.({ message: `Wrote ${oiers.length} contestants and ${records.length} records.` });
    await rematchBindings(snapshots, report);
    return {
        oiers: oiers.length,
        records: records.length,
        schools: schools.length,
        contests: contests.length,
        warnings: parsed.warnings.length,
    };
}

export async function bind(uid: number, oierId: number, realName: string) {
    const oier = await get(oierId);
    const udoc = await user.getById('system', uid);
    const reject = checkBind(oier, realName, udoc?.oierId);
    switch (reject) {
        case 'missing': throw new AwardOierNotFoundError(oierId);
        case 'already': throw new AwardAlreadyBoundError();
        case 'mismatch': throw new AwardNameMismatchError();
        case 'taken': throw new AwardOierTakenError();
        case null: break;
        default: {
            const exhaustive: never = reject;
            throw exhaustive;
        }
    }
    const claimed = await coll.findOneAndUpdate(
        { _id: oierId, uid: { $exists: false } },
        { $set: { uid } },
        { returnDocument: 'after' },
    );
    if (!claimed) throw new AwardOierTakenError();
    try {
        await user.setById(uid, { oierId, oierBoundAt: new Date(), ccfLevel: claimed.ccfLevel });
    } catch (e) {
        await coll.updateOne({ _id: oierId, uid }, { $unset: { uid: '' } });
        throw e;
    }
    return claimed;
}

export async function unbindByUid(uid: number) {
    const udoc = await user.coll.findOne({ _id: uid }, { projection: { oierId: 1 } });
    if (!udoc?.oierId) throw new AwardNotBoundError();
    await coll.updateOne({ _id: udoc.oierId, uid }, { $unset: { uid: '' } });
    await user.setById(uid, { ccfLevel: 0 }, { oierId: '', oierBoundAt: '' });
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
    const preferred = all.filter((o) => schoolsMatch(o.latestSchool, query.school, index));
    const rest = all.filter((o) => !schoolsMatch(o.latestSchool, query.school, index));
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
    await ctx.db.ensureIndexes(
        coll,
        { key: { name: 1 }, name: 'name' },
        { key: { uid: 1 }, name: 'uid', unique: true, sparse: true },
    );
    await ctx.db.ensureIndexes(
        recordColl,
        { key: { oierId: 1, year: -1 }, name: 'oier_year' },
        { key: { fingerprint: 1 }, name: 'fingerprint' },
    );
    await ctx.db.ensureIndexes(
        schoolColl,
        { key: { name: 1 }, name: 'name' },
    );
    await ctx.db.ensureIndexes(
        contestColl,
        { key: { name: 1 }, name: 'name', unique: true },
    );
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
    unbindByUid,
    apply,
};
