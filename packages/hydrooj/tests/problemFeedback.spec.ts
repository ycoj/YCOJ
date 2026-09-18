import assert from 'assert';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { after, before, describe, it } from 'node:test';

let mongod: MongoMemoryServer;
let client: MongoClient;
let coll: any;
let feedback: typeof import('../src/model/problemFeedback');

function mock(request: string, exports: any) {
    require.cache[require.resolve(request)] = { exports } as NodeJS.Module;
}

before(async () => {
    mongod = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongod.getUri());
    coll = client.db('problem-feedback-test').collection('problem.feedback');
    mock('../src/service/db', { collection: () => coll });
    Object.assign(global, { Hydro: { model: {} } });
    feedback = require('../src/model/problemFeedback');
});

after(async () => {
    await client?.close();
    await mongod?.stop();
});

describe('problem feedback', () => {
    it('trims content and creates an unconfirmed report', async () => {
        const doc = await feedback.add('system', 1000, 2, '  Missing input limits.  ');
        assert.equal(doc.content, 'Missing input limits.');
        assert.equal(doc.status, 'pending');
        assert.equal(doc.domainId, 'system');
        assert.equal(doc.pid, 1000);
        assert.ok(doc.createdAt instanceof Date);
    });

    it('rejects empty and oversized descriptions', async () => {
        await assert.rejects(feedback.add('system', 1000, 2, '   '), { name: 'ValidationError' });
        await assert.rejects(feedback.add('system', 1000, 2, 'x'.repeat(1001)), { name: 'ValidationError' });
        await assert.rejects(feedback.add('system', 1000, 2, { text: 'invalid' } as any), {
            name: 'ValidationError',
        });
        assert.equal(await coll.countDocuments({ content: '' }), 0);
    });

    it('updates status only inside the active domain', async () => {
        const doc = await feedback.add('domain-a', 1001, 3, 'Incorrect sample output.');
        const updated = await feedback.updateStatus('domain-a', doc._id, 'processing', 1);
        assert.equal(updated.status, 'processing');
        assert.equal(updated.reviewedBy, 1);
        assert.ok(updated.reviewedAt instanceof Date);
        await assert.rejects(
            feedback.updateStatus('domain-b', doc._id, 'resolved', 1),
            { name: 'NotFoundError' },
        );
        assert.equal((await coll.findOne({ _id: doc._id })).status, 'processing');
    });

    it('rejects unsupported statuses without changing the report', async () => {
        const doc = await feedback.add('system', 1002, 4, 'Bad data point.');
        await assert.rejects(
            feedback.updateStatus('system', doc._id, 'unknown' as any, 1),
            { name: 'ValidationError' },
        );
        assert.equal((await coll.findOne({ _id: new ObjectId(doc._id) })).status, 'pending');
    });
});
