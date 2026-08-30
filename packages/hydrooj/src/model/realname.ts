import { Filter, ObjectId } from 'mongodb';
import { Context } from '../context';
import {
    AwardNotBoundError, RealnameAlreadyApprovedError, RealnameApplicationNotFoundError, RealnameInvalidTransitionError,
    ValidationError,
} from '../error';
import type { RealnameApplication, RealnameStatus } from '../interface';
import {
    asDate, buildLatestRealnameListPipeline, parseRealnameFields, REALNAME_TRANSITIONS,
    RealnameReviewAction, RealnameUserStatus,
} from '../lib/realname';
import db from '../service/db';
import * as oier from './oier';
import user from './user';

declare module '../service/db' {
    interface Collections {
        realname: RealnameApplication;
    }
}

let coll = db.collection('realname');

async function syncUser(
    uid: number,
    status: RealnameStatus,
    fields: { realName: string, school: string },
    extra: { realnameSubmittedAt?: Date } = {},
) {
    await user.setById(uid, {
        realnameStatus: status,
        realName: fields.realName,
        realnameSchool: fields.school,
        ...extra,
    });
}

async function firstSubmittedAt(uid: number, fallback: Date) {
    const earliest = await getEarliestByUid(uid);
    return earliest?.submittedAt || fallback;
}

export function getMulti(query: Filter<RealnameApplication> = {}) {
    return coll.find(query);
}

export function get(id: ObjectId) {
    return coll.findOne({ _id: id });
}

export function getLatestByUid(uid: number) {
    return coll.find({ uid }).sort({ submittedAt: -1 }).limit(1).next();
}

export function getEarliestByUid(uid: number) {
    return coll.find({ uid, submittedAt: { $exists: true, $ne: null } }).sort({ submittedAt: 1 }).limit(1).next();
}

export async function paginateLatestByUid(
    filter: { uid?: Filter<RealnameApplication>['uid']; status?: RealnameApplication['status'] },
    page: number,
    pageSize: number,
): Promise<[RealnameApplication[], number, number]> {
    if (page <= 0) throw new ValidationError('page');
    const pipeline = buildLatestRealnameListPipeline(filter, page, pageSize);
    const [result] = await coll.aggregate<{
        count: { n: number }[];
        docs: RealnameApplication[];
    }>(pipeline, { allowDiskUse: true }).toArray();
    const count = result?.count[0]?.n || 0;
    return [result?.docs || [], Math.floor((count + pageSize - 1) / pageSize), count];
}

export async function submit(uid: number, realName: string, school: string) {
    const fields = parseRealnameFields(realName, school);
    const latest = await getLatestByUid(uid);
    const status = (latest?.status || 'none') as RealnameUserStatus;
    const nextStatus = REALNAME_TRANSITIONS[status].submit;
    if (!nextStatus) throw new RealnameAlreadyApprovedError();

    const now = new Date();
    const submittedAt = await firstSubmittedAt(uid, now);
    if (status === 'pending' && latest) {
        await coll.updateOne({ _id: latest._id }, {
            $set: {
                realName: fields.realName,
                school: fields.school,
                updatedAt: now,
            },
        });
        await syncUser(uid, 'pending', fields, { realnameSubmittedAt: submittedAt });
        return {
            ...latest,
            realName: fields.realName,
            school: fields.school,
            updatedAt: now,
        };
    }

    const doc: Omit<RealnameApplication, '_id'> = {
        uid,
        realName: fields.realName,
        school: fields.school,
        status: 'pending',
        submittedAt: now,
        updatedAt: now,
    };
    const { insertedId } = await coll.insertOne(doc as RealnameApplication);
    await syncUser(uid, 'pending', fields, { realnameSubmittedAt: submittedAt });
    return { _id: insertedId, ...doc };
}

export async function review(id: ObjectId, reviewer: number, action: RealnameReviewAction, reason = '') {
    const doc = await get(id);
    if (!doc) throw new RealnameApplicationNotFoundError(id.toHexString());
    const status = REALNAME_TRANSITIONS[doc.status][action];
    if (!status) throw new RealnameInvalidTransitionError();
    const now = new Date();
    const $set: Partial<RealnameApplication> = {
        status,
        reviewedAt: now,
        reviewedBy: reviewer,
        rejectReason: action === 'approve' ? '' : reason,
        updatedAt: now,
    };
    const result = await coll.updateOne({ _id: id, status: doc.status }, { $set });
    if (!result.modifiedCount) throw new RealnameInvalidTransitionError();
    const fields = { realName: doc.realName, school: doc.school };
    await syncUser(doc.uid, status, fields);
    if (action === 'revoke') {
        try {
            await oier.unbindByUid(doc.uid);
        } catch (e) {
            if (!(e instanceof AwardNotBoundError)) throw e;
        }
    }
    return { ...doc, ...$set };
}

export async function apply(ctx: Context) {
    coll = ctx.db.collection('realname');
    await ctx.db.ensureIndexes(
        coll,
        { key: { uid: 1, submittedAt: -1 }, name: 'uid_submitted' },
        { key: { status: 1, submittedAt: -1 }, name: 'status_submitted' },
    );
    const STALE_BACKFILL_BATCH_SIZE = 50;
    const cursor = ctx.db.collection('user').find({
        realnameStatus: { $in: ['pending', 'approved', 'rejected'] },
    }).project<{ _id: number, realnameSubmittedAt?: unknown }>({ _id: 1, realnameSubmittedAt: 1 });
    const batch: { _id: number, realnameSubmittedAt?: unknown }[] = [];
    const flush = async () => {
        await Promise.all(batch.map(async (udoc) => {
            const earliest = await getEarliestByUid(udoc._id);
            if (!earliest?.submittedAt) return;
            const current = asDate(udoc.realnameSubmittedAt);
            if (!current || current.getTime() > earliest.submittedAt.getTime()) {
                await user.setById(udoc._id, { realnameSubmittedAt: earliest.submittedAt });
            }
        }));
        batch.length = 0;
    };
    for await (const udoc of cursor) {
        batch.push(udoc);
        if (batch.length >= STALE_BACKFILL_BATCH_SIZE) await flush();
    }
    if (batch.length) await flush();
}

global.Hydro.model.realname = {
    get,
    getEarliestByUid,
    getLatestByUid,
    getMulti,
    paginateLatestByUid,
    review,
    submit,
    apply,
};
