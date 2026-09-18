import { Filter, ObjectId } from 'mongodb';
import { Context } from '../context';
import { NotFoundError, ValidationError } from '../error';
import {
    PROBLEM_FEEDBACK_STATUSES, ProblemFeedbackDoc, ProblemFeedbackStatus,
} from '../interface';
import db from '../service/db';

let coll = db.collection('problem.feedback');

function normalizeContent(content: string) {
    if (typeof content !== 'string') throw new ValidationError('content');
    const normalized = content.trim();
    if (!normalized || normalized.length > 1000) throw new ValidationError('content');
    return normalized;
}

export async function add(domainId: string, pid: number, owner: number, content: string) {
    const now = new Date();
    const doc: Omit<ProblemFeedbackDoc, '_id'> = {
        domainId,
        pid,
        owner,
        content: normalizeContent(content),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
    };
    const { insertedId } = await coll.insertOne(doc as ProblemFeedbackDoc);
    return { _id: insertedId, ...doc };
}

export function getMulti(query: Filter<ProblemFeedbackDoc> = {}) {
    return coll.find(query).sort({ createdAt: -1 });
}

export async function updateStatus(
    domainId: string,
    id: ObjectId,
    status: ProblemFeedbackStatus,
    reviewer: number,
) {
    if (!PROBLEM_FEEDBACK_STATUSES.includes(status)) throw new ValidationError('status');
    const now = new Date();
    const doc = await coll.findOneAndUpdate(
        { _id: id, domainId },
        { $set: { status, reviewedBy: reviewer, reviewedAt: now, updatedAt: now } },
        { returnDocument: 'after' },
    );
    if (!doc) throw new NotFoundError(id.toHexString());
    return doc;
}

export async function apply(ctx: Context) {
    coll = ctx.db.collection('problem.feedback');
    await ctx.db.clearIndexes(coll, ['status_created']);
    await ctx.db.ensureIndexes(
        coll,
        { key: { domainId: 1, status: 1, createdAt: -1 }, name: 'domain_status_created' },
        { key: { domainId: 1, createdAt: -1 }, name: 'domain_created' },
        { key: { domainId: 1, pid: 1, createdAt: -1 }, name: 'problem_created' },
        { key: { owner: 1, createdAt: -1 }, name: 'owner_created' },
    );
}

global.Hydro.model.problemFeedback = {
    add,
    getMulti,
    updateStatus,
    apply,
};
