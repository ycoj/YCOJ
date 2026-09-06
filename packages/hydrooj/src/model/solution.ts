import { ObjectId } from 'mongodb';
import {
    SolutionNotFoundError, SolutionReviewBusyError, SolutionReviewConflictError, SolutionSubmissionBlockedError, ValidationError,
} from '../error';
import { SolutionReviewStatus } from '../interface';
import bus from '../service/bus';
import * as document from './document';
import domain from './domain';

class SolutionModel {
    static async migrateLegacy() {
        await document.coll.updateMany(
            { docType: document.TYPE_PROBLEM_SOLUTION, reviewStatus: { $exists: false } },
            { $set: { reviewStatus: SolutionReviewStatus.Approved, revision: 0 } },
        );
    }

    static readonly reviewLabels = {
        [SolutionReviewStatus.Featured]: 'Featured Solution',
        [SolutionReviewStatus.Approved]: 'Approved',
        [SolutionReviewStatus.Pending]: 'Unreviewed',
        [SolutionReviewStatus.Rejected]: 'Rejected',
        [SolutionReviewStatus.Blocked]: 'Rejected and author blocked',
    };

    static async isBlocked(domainId: string, uid: number) {
        return !!(await domain.collUser.findOne({ domainId, uid }))?.solutionBlocked;
    }

    // A database lease serializes solution writes for an author across server processes.
    // Persist bulk transitions before applying them, so a retry can finish interrupted work.
    private static async withAuthor<T>(domainId: string, uid: number, action: () => Promise<T>): Promise<T> {
        await domain.collUser.updateOne({ domainId, uid }, { $setOnInsert: { domainId, uid } }, { upsert: true });
        const token = new ObjectId();
        const lease = () => new Date(Date.now() + 300_000);
        const locked = await domain.collUser.findOneAndUpdate({
            domainId, uid,
            $or: [{ solutionLock: { $exists: false } }, { solutionLockUntil: { $lt: new Date() } }],
        }, { $set: { solutionLock: token, solutionLockUntil: lease() } });
        if (!locked) throw new SolutionReviewBusyError();
        const heartbeat = setInterval(() => {
            domain.collUser.updateOne({ domainId, uid, solutionLock: token }, { $set: { solutionLockUntil: lease() } })
                .catch(() => {});
        }, 30_000);
        try {
            await this.finishTransition(domainId, uid);
            return await action();
        } finally {
            clearInterval(heartbeat);
            await domain.collUser.updateOne({ domainId, uid, solutionLock: token }, {
                $unset: { solutionLock: '', solutionLockUntil: '' },
            });
        }
    }

    private static async finishTransition(domainId: string, uid: number) {
        const author = await domain.collUser.findOne({ domainId, uid });
        const transition = author?.solutionReviewTransition;
        if (!transition) return;
        const filter: any = { domainId, docType: document.TYPE_PROBLEM_SOLUTION, owner: uid };
        if (!transition.blocked) filter.reviewStatus = SolutionReviewStatus.Blocked;
        await document.coll.updateMany(filter, {
            $set: {
                reviewStatus: transition.blocked ? SolutionReviewStatus.Blocked : SolutionReviewStatus.Pending,
                reviewedBy: transition.reviewer,
                reviewedAt: transition.at,
            },
            $inc: { revision: 1 },
        });
        await domain.collUser.updateOne({ domainId, uid }, { $unset: { solutionReviewTransition: '' } });
    }

    static async add(domainId: string, pid: number, owner: number, content: string) {
        return this.withAuthor(domainId, owner, async () => {
            if (await this.isBlocked(domainId, owner)) throw new SolutionSubmissionBlockedError();
            return document.add(
                domainId, content, owner, document.TYPE_PROBLEM_SOLUTION,
                null, document.TYPE_PROBLEM, pid,
                { reply: [], vote: 0, reviewStatus: SolutionReviewStatus.Pending, revision: 0 },
            );
        });
    }

    static ensureParent(doc: { parentId: number }, pid: number, domainId: string, psid: ObjectId) {
        if (doc.parentId !== pid) throw new SolutionNotFoundError(domainId, psid);
    }

    static async review(domainId: string, psid: ObjectId, revision: number, status: SolutionReviewStatus, reviewer: number) {
        const outcomes = [
            SolutionReviewStatus.Featured, SolutionReviewStatus.Approved, SolutionReviewStatus.Rejected, SolutionReviewStatus.Blocked,
        ];
        if (!outcomes.includes(status)) {
            throw new ValidationError('status');
        }
        const original = await this.get(domainId, psid);
        return this.withAuthor(domainId, original.owner, async () => {
            const doc = await this.get(domainId, psid);
            if (doc.revision !== revision || doc.reviewLock !== reviewer || !doc.reviewLockUntil || doc.reviewLockUntil < new Date()) throw new SolutionReviewConflictError();
            if (status === SolutionReviewStatus.Blocked) {
                await this.setBlocked(domainId, doc.owner, true, reviewer);
                await document.coll.updateOne({ domainId, docType: document.TYPE_PROBLEM_SOLUTION, docId: psid }, { $unset: { reviewLock: '', reviewLockUntil: '' } });
                return this.get(domainId, psid);
            }
            if (await this.isBlocked(domainId, doc.owner)) throw new SolutionSubmissionBlockedError();
            const updated = await document.coll.findOneAndUpdate(
                { domainId, docType: document.TYPE_PROBLEM_SOLUTION, docId: psid, revision },
                { $set: { reviewStatus: status, reviewedBy: reviewer, reviewedAt: new Date() }, $unset: { reviewLock: '', reviewLockUntil: '' }, $inc: { revision: 1 } },
                { returnDocument: 'after' },
            );
            if (!updated) throw new SolutionReviewConflictError();
            return updated;
        });
    }

    private static async setBlocked(domainId: string, uid: number, blocked: boolean, reviewer: number) {
        const at = new Date();
        await domain.setUserInDomain(domainId, uid, {
            solutionBlocked: blocked,
            solutionBlockedBy: reviewer,
            solutionBlockedAt: at,
            solutionReviewTransition: { blocked, reviewer, at },
        });
        await this.finishTransition(domainId, uid);
    }

    static async unblock(domainId: string, uid: number, reviewer: number) {
        return this.withAuthor(domainId, uid, async () => {
            if (await this.isBlocked(domainId, uid)) await this.setBlocked(domainId, uid, false, reviewer);
        });
    }

    static async get(domainId: string, psid: ObjectId) {
        const psdoc = await document.get(domainId, document.TYPE_PROBLEM_SOLUTION, psid);
        if (!psdoc) throw new SolutionNotFoundError(domainId, psid);
        return psdoc;
    }

    static getMany(domainId: string, query: any, sort: any, page: number, limit: number) {
        return document.getMulti(domainId, document.TYPE_PROBLEM_SOLUTION, query)
            .sort(sort)
            .skip((page - 1) * limit).limit(limit)
            .toArray();
    }

    static async edit(domainId: string, psid: ObjectId, content: string) {
        const original = await this.get(domainId, psid);
        return this.withAuthor(domainId, original.owner, async () => {
            const doc = await this.get(domainId, psid);
            if (doc.content === content) return doc;
            const blocked = await this.isBlocked(domainId, doc.owner);
            const $set = { content, reviewStatus: blocked ? SolutionReviewStatus.Blocked : SolutionReviewStatus.Pending };
            const $unset = blocked ? undefined : { reviewedBy: '' as const, reviewedAt: '' as const };
            await bus.parallel('document/set', domainId, document.TYPE_PROBLEM_SOLUTION, psid, $set, $unset);
            return document.coll.findOneAndUpdate(
                { domainId, docType: document.TYPE_PROBLEM_SOLUTION, docId: psid },
                {
                    $set,
                    $inc: { revision: 1 },
                    ...($unset ? { $unset } : {}),
                },
                { returnDocument: 'after' },
            );
        });
    }

    static async del(domainId: string, psid: ObjectId) {
        const doc = await this.get(domainId, psid);
        return this.withAuthor(domainId, doc.owner, () => Promise.all([
            document.deleteOne(domainId, document.TYPE_PROBLEM_SOLUTION, psid),
            document.deleteMultiStatus(domainId, document.TYPE_PROBLEM_SOLUTION, { docId: psid }),
        ]));
    }

    static count(domainId: string, query: any) {
        return document.count(domainId, document.TYPE_PROBLEM_SOLUTION, query);
    }

    static getMulti(domainId: string, pid: number, query: any = {}) {
        return document.getMulti(
            domainId, document.TYPE_PROBLEM_SOLUTION,
            { parentType: document.TYPE_PROBLEM, parentId: pid, ...query },
        ).sort({ reviewStatus: -1, vote: -1, docId: -1 });
    }

    static getReviewQueue(domainId: string, query: any = {}) {
        return document.getMulti(domainId, document.TYPE_PROBLEM_SOLUTION, query).sort({ docId: 1 });
    }

    static async claimReview(domainId: string, query: any, reviewer: number) {
        const now = new Date();
        return document.coll.findOneAndUpdate({ domainId, docType: document.TYPE_PROBLEM_SOLUTION, ...query,
            $or: [{ reviewLockUntil: { $exists: false } }, { reviewLockUntil: { $lt: now } }, { reviewLock: reviewer }] },
        { $set: { reviewLock: reviewer, reviewLockUntil: new Date(now.getTime() + 60_000) } },
        { sort: { docId: 1 }, returnDocument: 'after' });
    }

    static getByUser(domainId: string, uid: number) {
        return document.getMulti(
            domainId, document.TYPE_PROBLEM_SOLUTION,
            { parentType: document.TYPE_PROBLEM, owner: uid },
        ).sort({ _id: -1 });
    }

    static reply(domainId: string, psid: ObjectId, owner: number, content: string) {
        return document.push(domainId, document.TYPE_PROBLEM_SOLUTION, psid, 'reply', content, owner);
    }

    static getReply(domainId: string, psid: ObjectId, psrid: ObjectId) {
        return document.getSub(domainId, document.TYPE_PROBLEM_SOLUTION, psid, 'reply', psrid);
    }

    static editReply(domainId: string, psid: ObjectId, psrid: ObjectId, content: string) {
        return document.setSub(domainId, document.TYPE_PROBLEM_SOLUTION, psid, 'reply', psrid, { content });
    }

    static delReply(domainId: string, psid: ObjectId, psrid: ObjectId) {
        return document.deleteSub(domainId, document.TYPE_PROBLEM_SOLUTION, psid, 'reply', psrid);
    }

    static async vote(domainId: string, psid: ObjectId, uid: number, value: number) {
        const doc = await document.get(domainId, document.TYPE_PROBLEM_SOLUTION, psid);
        if (!doc) throw new SolutionNotFoundError(domainId, psid);
        const before = await document.setStatus(
            domainId, document.TYPE_PROBLEM_SOLUTION, psid, uid,
            { vote: value }, null, 'before',
        );
        let inc = value;
        if (before?.vote) inc -= before.vote;
        return inc
            ? await document.inc(domainId, document.TYPE_PROBLEM_SOLUTION, psid, 'vote', inc)
            : doc;
    }

    static async getListStatus(domainId: string, psids: ObjectId[], uid: number) {
        const result: Record<string, { docId: ObjectId, vote: number }> = {};
        const res = await document.getMultiStatus(
            domainId, document.TYPE_PROBLEM_SOLUTION, { uid, docId: { $in: psids } },
        ).project<any>({ docId: 1, vote: 1 }).toArray();
        for (const i of res) result[i.docId] = i;
        return result;
    }
}

bus.on('problem/delete', async (domainId, docId) => {
    const psids = await document.getMulti(
        domainId, document.TYPE_PROBLEM_SOLUTION,
        { parentType: document.TYPE_PROBLEM, parentId: docId },
    ).project({ docId: 1 }).map((psdoc) => psdoc.docId).toArray();
    return await Promise.all([
        document.deleteMulti(domainId, document.TYPE_PROBLEM_SOLUTION, { docId: { $in: psids } }),
        document.deleteMultiStatus(domainId, document.TYPE_PROBLEM_SOLUTION, { docId: { $in: psids } }),
    ]);
});

export default SolutionModel;
global.Hydro.model.solution = SolutionModel;
