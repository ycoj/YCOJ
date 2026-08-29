import { Filter, ObjectId } from 'mongodb';
import { Context } from '../context';
import {
    RealnameAlreadyApprovedError, RealnameApplicationNotFoundError, RealnameInvalidTransitionError,
} from '../error';
import type { RealnameApplication, RealnameStatus } from '../interface';
import {
    parseRealnameFields, REALNAME_TRANSITIONS, RealnameReviewAction, RealnameUserStatus,
} from '../lib/realname';
import db from '../service/db';
import user from './user';

declare module '../service/db' {
    interface Collections {
        realname: RealnameApplication;
    }
}

let coll = db.collection('realname');

async function syncUser(uid: number, status: RealnameStatus, fields: { realName: string, school: string }) {
    await user.setById(uid, {
        realnameStatus: status,
        realName: fields.realName,
        realnameSchool: fields.school,
    });
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

export async function submit(uid: number, realName: string, school: string) {
    const fields = parseRealnameFields(realName, school);
    const latest = await getLatestByUid(uid);
    const status = (latest?.status || 'none') as RealnameUserStatus;
    const nextStatus = REALNAME_TRANSITIONS[status].submit;
    if (!nextStatus) throw new RealnameAlreadyApprovedError();

    const now = new Date();
    if (status === 'pending' && latest) {
        await coll.updateOne({ _id: latest._id }, {
            $set: {
                realName: fields.realName,
                school: fields.school,
                updatedAt: now,
            },
        });
        await syncUser(uid, 'pending', fields);
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
    await syncUser(uid, 'pending', fields);
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
    await syncUser(doc.uid, status, { realName: doc.realName, school: doc.school });
    return { ...doc, ...$set };
}

export async function apply(ctx: Context) {
    coll = ctx.db.collection('realname');
    await ctx.db.ensureIndexes(
        coll,
        { key: { uid: 1, submittedAt: -1 }, name: 'uid_submitted' },
        { key: { status: 1, submittedAt: -1 }, name: 'status_submitted' },
    );
}

global.Hydro.model.realname = {
    get,
    getLatestByUid,
    getMulti,
    review,
    submit,
    apply,
};
