/* eslint-disable no-await-in-loop */
import assert from 'assert';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { after, before, describe, it } from 'node:test';
import { SolutionReviewStatus as Review } from '../src/interface';

let mongod: MongoMemoryServer;
let client: MongoClient;
let coll: any;
let authors: any;
let solution: typeof import('../src/model/solution').default;

function mock(request: string, exports: any) {
    require.cache[require.resolve(request)] = { exports } as NodeJS.Module;
}

before(async () => {
    mongod = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongod.getUri());
    coll = client.db('solution-review-test').collection('document');
    authors = client.db('solution-review-test').collection('domain.user');
    await authors.createIndex({ domainId: 1, uid: 1 }, { unique: true });
    mock('../src/service/bus', { on() {}, async parallel() { return undefined; } });
    mock('../src/model/domain', {
        collUser: authors,
        setUserInDomain: (domainId, uid, params) => authors.updateOne({ domainId, uid }, { $set: params }),
    });
    mock('../src/model/document', {
        coll,
        TYPE_PROBLEM: 10,
        TYPE_PROBLEM_SOLUTION: 11,
        async add(domainId, content, owner, docType, _, parentType, parentId, extra) {
            const docId = new ObjectId();
            await coll.insertOne({ _id: docId, docId, domainId, content, owner, docType, parentType, parentId, ...extra });
            return docId;
        },
        get: (domainId, docType, docId) => coll.findOne({ domainId, docType, docId }),
        getMulti: (domainId, docType, query) => coll.find({ domainId, docType, ...query }),
        deleteOne: (domainId, docType, docId) => coll.deleteOne({ domainId, docType, docId }),
        async deleteMultiStatus() { return undefined; },
    });
    Object.assign(global, { Hydro: { model: {} } });
    solution = require('../src/model/solution').default;
});

after(async () => {
    await client?.close();
    await mongod?.stop();
});

describe('problem solution review', () => {
    it('migrates only legacy solutions and is safe to repeat', async () => {
        const legacy = new ObjectId();
        const unrelated = new ObjectId();
        await coll.insertMany([
            { _id: legacy, docId: legacy, docType: 11, domainId: 'legacy', content: 'old' },
            { _id: unrelated, docType: 20, domainId: 'legacy', content: 'discussion' },
        ]);
        const fresh = await solution.add('legacy', 1, 1, 'new');
        await solution.migrateLegacy();
        await solution.migrateLegacy();
        const doc = await coll.findOne({ _id: legacy });
        assert.equal(doc.reviewStatus, Review.Approved);
        assert.equal(doc.revision, 0);
        assert.equal(doc.reviewedBy, undefined);
        assert.equal((await solution.get('legacy', fresh)).reviewStatus, Review.Pending);
        assert.equal((await coll.findOne({ _id: unrelated })).reviewStatus, undefined);
    });

    it('creates pending solutions; reviews and edits invalidate stale decisions', async () => {
        const id = await solution.add('review', 1, 10, 'first');
        let doc = await solution.get('review', id);
        assert.equal(doc.reviewStatus, Review.Pending);
        assert.equal(doc.revision, 0);
        await solution.review('review', id, 0, Review.Featured, 99);
        doc = await solution.get('review', id);
        assert.equal(doc.reviewStatus, Review.Featured);
        assert.equal(doc.reviewedBy, 99);
        assert.ok(doc.reviewedAt instanceof Date);
        await solution.edit('review', id, 'first');
        assert.equal((await solution.get('review', id)).revision, doc.revision);
        await solution.edit('review', id, 'changed');
        doc = await solution.get('review', id);
        assert.equal(doc.reviewStatus, Review.Pending);
        assert.equal(doc.reviewedBy, undefined);
        await assert.rejects(solution.review('review', id, 1, Review.Approved, 99), { name: 'SolutionReviewConflictError' });
        await solution.review('review', id, doc.revision, Review.Rejected, 99);
        doc = await solution.get('review', id);
        await solution.review('review', id, doc.revision, Review.Approved, 99);
        assert.equal((await solution.get('review', id)).reviewStatus, Review.Approved);
        await assert.rejects(solution.review('review', id, 4, Review.Pending, 99), { name: 'ValidationError' });
    });

    it('orders states before votes and pagination, with stable ties', async () => {
        const ids = [];
        const states = [[Review.Pending, 100], [Review.Featured, 0], [Review.Approved, 80], [Review.Rejected, 200], [Review.Featured, 0]];
        for (const [status, vote] of states) {
            const id = await solution.add('sorting', 1, 20, 'text');
            await coll.updateOne({ docId: id }, { $set: { reviewStatus: status, vote } });
            ids.push(id.toString());
        }
        const first = await solution.getMulti('sorting', 1).limit(2).toArray();
        const rest = await solution.getMulti('sorting', 1).skip(2).toArray();
        assert.deepEqual([...first, ...rest].map((doc) => doc.docId.toString()), [ids[4], ids[1], ids[2], ids[0], ids[3]]);
    });

    it('blocks every solution in only one domain, retaining public access, then unblocks to pending', async () => {
        const a = await solution.add('blocking', 1, 30, 'one');
        const b = await solution.add('blocking', 2, 30, 'two');
        const other = await solution.add('other-domain', 1, 30, 'elsewhere');
        await solution.review('blocking', b, 0, Review.Featured, 99);
        await solution.review('blocking', a, 0, Review.Blocked, 99);
        assert.equal((await solution.get('blocking', b)).reviewStatus, Review.Blocked);
        assert.equal((await solution.get('other-domain', other)).reviewStatus, Review.Pending);
        assert.equal((await solution.getMulti('blocking', 1).toArray()).length, 1);
        await assert.rejects(solution.add('blocking', 3, 30, 'new'), { name: 'SolutionSubmissionBlockedError' });
        await solution.add('other-domain', 2, 30, 'allowed');
        const blocked = await solution.get('blocking', b);
        await assert.rejects(solution.review('blocking', b, blocked.revision, Review.Approved, 99), { name: 'SolutionSubmissionBlockedError' });
        await solution.edit('blocking', b, 'edited');
        assert.equal((await solution.get('blocking', b)).reviewStatus, Review.Blocked);
        await solution.unblock('blocking', 30, 99);
        assert.equal(await solution.isBlocked('blocking', 30), false);
        assert.equal((await solution.get('blocking', a)).reviewStatus, Review.Pending);
        assert.equal((await solution.get('blocking', b)).reviewStatus, Review.Pending);
        await solution.unblock('blocking', 30, 99);
        await solution.add('blocking', 3, 30, 'allowed again');
    });

    it('rejects concurrent author writes and recovers an interrupted bulk transition', async () => {
        const id = await solution.add('concurrency', 1, 40, 'text');
        await authors.updateOne({ domainId: 'concurrency', uid: 40 }, { $set: {
            solutionLock: new ObjectId(), solutionLockUntil: new Date(Date.now() + 60_000),
        } });
        await assert.rejects(solution.edit('concurrency', id, 'racing'), { name: 'SolutionReviewBusyError' });
        await authors.updateOne({ domainId: 'concurrency', uid: 40 }, { $set: {
            solutionLockUntil: new Date(0), solutionBlocked: true,
            solutionReviewTransition: { blocked: true, reviewer: 99, at: new Date() },
        } });
        await assert.rejects(solution.add('concurrency', 2, 40, 'blocked'), { name: 'SolutionSubmissionBlockedError' });
        assert.equal((await solution.get('concurrency', id)).reviewStatus, Review.Blocked);
        assert.equal((await authors.findOne({ domainId: 'concurrency', uid: 40 })).solutionReviewTransition, undefined);
    });

    it('prevents cross-domain and wrong-problem access', async () => {
        const id = await solution.add('ownership', 1, 50, 'text');
        await assert.rejects(solution.get('wrong', id), { name: 'SolutionNotFoundError' });
        const doc = await solution.get('ownership', id);
        assert.throws(() => solution.ensureParent(doc, 2, 'ownership', id), { name: 'SolutionNotFoundError' });
        solution.ensureParent(doc, 1, 'ownership', id);
    });
});
