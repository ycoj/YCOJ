import assert from 'assert';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { after, before, beforeEach, describe, it } from 'node:test';

function mockModule(request: string, exports: unknown) {
    require.cache[require.resolve(request)] = { exports } as NodeJS.Module;
}

Object.assign(global, { Hydro: { model: {}, ui: {} } });
mockModule('../../src/service/db', { collection: () => null });
const { ensureJobIndexes, HtmlToMarkdownJobModel } = require('../../src/model/htmlToMarkdownJob');

let mongod: MongoMemoryServer;
let client: MongoClient;

before(async () => {
    mongod = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongod.getUri());
});

after(async () => {
    await client?.close();
    await mongod?.stop();
});

function freshStore(capacity = 100, capacityPerOwner = 10) {
    const db = client.db(`html2md-${new ObjectId().toHexString()}`);
    const collection = db.collection('html_to_markdown_job');
    return { store: new HtmlToMarkdownJobModel(collection, capacity, capacityPerOwner), collection };
}

const owner = { domainId: 'test', pid: 1, uid: 2 };
const TIMEOUT = 900_000;
const RETENTION = 3_600_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('HTML-to-Markdown job store', () => {
    let store: HtmlToMarkdownJobModel;
    let collection;
    beforeEach(async () => {
        ({ store, collection } = freshStore());
        await ensureJobIndexes(collection);
    });

    it('admits a pending job and exposes only the documented result fields', async () => {
        const jobId = await store.submit(owner);
        assert.ok(jobId);
        assert.deepEqual(await store.view(jobId, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION }),
            { jobId, status: 'pending' });
    });

    it('isolates jobs by owner, problem, and domain', async () => {
        const jobId = await store.submit(owner);
        assert.ok(await store.get(jobId, owner));
        assert.equal(await store.get(jobId, { ...owner, uid: 3 }), null);
        assert.equal(await store.get(jobId, { ...owner, pid: 3 }), null);
        assert.equal(await store.get(jobId, { ...owner, domainId: 'other' }), null);
    });

    it('claims a pending job exactly once across racing callers', async () => {
        const jobId = await store.submit(owner);
        const claims = await Promise.all([store.claim(jobId), store.claim(jobId), store.claim(jobId)]);
        assert.equal(claims.filter(Boolean).length, 1);
        assert.equal((await store.get(jobId, owner)).status, 'running');
        assert.ok((await store.get(jobId, owner)).claimedAt instanceof Date);
    });

    it('keeps only the first terminal transition and ignores late results', async () => {
        const jobId = await store.submit(owner);
        await store.claim(jobId);
        assert.ok(await store.finish(jobId, { markdown: '# Done' }, RETENTION));
        assert.equal(await store.finish(jobId, { error: 'late' }, RETENTION), null);
        const result = await store.view(jobId, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION });
        assert.deepEqual(result, { jobId, status: 'completed', markdown: '# Done' });
        assert.equal((await store.markFailed(jobId, 'stale', RETENTION)).matchedCount, 0);
    });

    it('caps each owner atomically without exceeding the shared pool', async () => {
        const { store: capped } = freshStore(50, 3);
        await ensureJobIndexes(capped.coll);
        const admitted = await Promise.all(
            Array.from({ length: 8 }, () => capped.submit(owner)),
        );
        assert.equal(admitted.filter(Boolean).length, 3);
        assert.equal(await capped.count(), 3);
        const other = await capped.submit({ ...owner, uid: 77 });
        assert.ok(other);
    });

    it('never lets concurrent admits exceed the shared capacity', async () => {
        const { store: capped } = freshStore(12, 12);
        await ensureJobIndexes(capped.coll);
        const results = await Promise.all(
            Array.from({ length: 30 }, (_, index) => capped.submit({ ...owner, pid: index + 1 })),
        );
        assert.equal(results.filter(Boolean).length, 12);
        assert.equal(await capped.count(), 12);
    });

    it('retains terminal results only until the retention window elapses', async () => {
        const jobId = await store.submit(owner);
        await store.claim(jobId);
        await store.finish(jobId, { markdown: '# Keep' }, 25);
        assert.equal((await store.view(jobId, owner, { timeoutMs: TIMEOUT, retentionMs: 25 })).status, 'completed');
        await wait(45);
        assert.equal(await store.view(jobId, owner, { timeoutMs: TIMEOUT, retentionMs: 25 }), null);
        assert.ok(await store.submit(owner));
    });

    it('treats a stalled job as timed out on read and frees its slot', async () => {
        const jobId = await store.submit(owner);
        await collection.updateOne({ jobId }, { $set: { createdAt: new Date(Date.now() - 200) } });
        const result = await store.view(jobId, owner, { timeoutMs: 100, retentionMs: RETENTION });
        assert.deepEqual(result, { jobId, status: 'failed', error: 'HTML-to-Markdown conversion timed out.' });
        assert.equal((await store.get(jobId, owner)).status, 'failed');
    });

    it('sweeps stalled running jobs and deletes expired results', async () => {
        const stalled = await store.submit(owner);
        await store.claim(stalled);
        await collection.updateOne({ jobId: stalled }, { $set: { claimedAt: new Date(Date.now() - 5000) } });
        const finished = await store.submit({ ...owner, pid: 2 });
        await store.claim(finished);
        await store.finish(finished, { markdown: '# x' }, 1);
        await wait(20);
        await store.reclaimStalled(1000, RETENTION);
        await store.deleteExpired();
        assert.equal((await store.get(stalled, owner)).status, 'failed');
        assert.equal(await store.get(finished, owner), null);
    });
});
