import assert from 'assert';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { after, before, beforeEach, describe, it } from 'node:test';

function mockModule(request: string, exports: unknown) {
    require.cache[require.resolve(request)] = { exports } as NodeJS.Module;
}

Object.assign(global, { Hydro: { model: {}, ui: {} } });
mockModule('../../src/service/db', { collection: () => null });
const { ensureJobIndexes, MarkdownOcrJobModel } = require('../../src/model/markdownOcrJob');
const { MarkdownOcrJobs } = require('../../src/lib/ai/ocr/jobs');

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
    const db = client.db(`markdown-ocr-${new ObjectId().toHexString()}`);
    const collection = db.collection('background_task');
    return { store: new MarkdownOcrJobModel(collection, capacity, capacityPerOwner), collection };
}

const owner = { domainId: 'test', pid: 0, uid: 2 };
const TIMEOUT = 900_000;
const RETENTION = 3_600_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const imageFile = { data: Buffer.from('png-bytes'), mediaType: 'image/png', kind: 'image' };

describe('Markdown OCR job store', () => {
    let store: any;
    let collection: any;
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

    it('isolates jobs by owner and domain', async () => {
        const jobId = await store.submit(owner);
        assert.ok(await store.get(jobId, owner));
        assert.equal(await store.get(jobId, { ...owner, uid: 3 }), null);
        assert.equal(await store.get(jobId, { ...owner, domainId: 'other' }), null);
    });

    it('keeps only the first terminal transition and ignores late results', async () => {
        const jobId = await store.submit(owner);
        await store.claim(jobId);
        assert.ok(await store.finish(jobId, { markdown: '# Done', pages: 2 }, RETENTION));
        assert.equal(await store.finish(jobId, { error: 'late' }, RETENTION), null);
        const result = await store.view(jobId, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION });
        assert.deepEqual(result, { jobId, status: 'completed', markdown: '# Done', pages: 2 });
    });

    it('exposes live page progress while running and clears it on settle', async () => {
        const jobId = await store.submit(owner);
        await store.claim(jobId);
        await store.setProgress(jobId, 2, 5);
        assert.deepEqual(await store.view(jobId, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION }),
            { jobId, status: 'running', progress: { done: 2, total: 5 } });
        await store.finish(jobId, { markdown: '# Done', pages: 5 }, RETENTION);
        const result = await store.view(jobId, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION });
        assert.deepEqual(result, { jobId, status: 'completed', markdown: '# Done', pages: 5 });
        assert.equal((await store.get(jobId, owner)).progress, undefined);
    });

    it('keeps the API key and file bytes in memory while persisting metadata', async () => {
        const config = { enabled: true, profileId: 'test', apiKey: 'test-secret', model: 'test-model' };
        const jobs = new MarkdownOcrJobs(async (receivedConfig, receivedFile) => {
            assert.deepEqual(receivedConfig, config);
            assert.equal(receivedFile.data.toString(), 'png-bytes');
            return { markdown: '# test', pages: 1 };
        }, { store });
        const { jobId } = await jobs.submit(owner, config, imageFile, { filename: 'scan.png', size: 9 });
        await jobs.drain();
        const doc = await store.get(jobId, owner);
        assert.equal(doc.status, 'completed');
        assert.deepEqual(doc.payload, {
            config: { enabled: true, profileId: 'test', model: 'test-model' },
            file: { mediaType: 'image/png', kind: 'image', filename: 'scan.png', size: 9 },
        });
        assert.equal(config.apiKey, 'test-secret');
        assert.equal(doc.payload.file.data, undefined);
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

    it('frees the slot as soon as a job completes, not on expiry', async () => {
        const { store: capped } = freshStore(1, 1);
        await ensureJobIndexes(capped.coll);
        const first = await capped.submit(owner);
        assert.equal(await capped.submit(owner), null, 'the single slot is held while the job is in flight');
        await capped.claim(first);
        await capped.finish(first, { markdown: '# done', pages: 1 }, RETENTION);
        assert.ok(await capped.submit(owner), 'settling the job frees its slot immediately');
        assert.equal((await capped.view(first, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION })).status, 'completed',
            'the result stays pollable within the retention window');
    });

    it('treats a stalled job as timed out on read and frees its slot', async () => {
        const jobId = await store.submit(owner);
        await collection.updateOne({ jobId }, { $set: { createdAt: new Date(Date.now() - 200) } });
        const result = await store.view(jobId, owner, { timeoutMs: 100, retentionMs: RETENTION });
        assert.deepEqual(result, { jobId, status: 'failed', error: 'Markdown OCR timed out.' });
        assert.equal((await store.get(jobId, owner)).status, 'failed');
    });

    it('runs the conversion with the runtime payload and writes page progress', async () => {
        const seen: any = {};
        let release: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const jobs = new MarkdownOcrJobs(async (config, file, onPage) => {
            seen.config = config;
            seen.file = file;
            await onPage(1, 4);
            await gate;
            return { markdown: '# pages', pages: 4 };
        }, { store });
        const submitted = await jobs.submit(owner, { enabled: true, apiKey: 'k' }, imageFile);
        for (let i = 0; i < 100; i++) {
            // eslint-disable-next-line no-await-in-loop
            const view = await store.view(submitted.jobId, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION });
            if (view.status === 'running' && view.progress) {
                assert.deepEqual(view.progress, { done: 1, total: 4 });
                break;
            }
            // eslint-disable-next-line no-await-in-loop
            await wait(5);
        }
        release!();
        await jobs.drain();
        assert.equal(seen.file.data.toString(), 'png-bytes');
        assert.equal(seen.config.apiKey, 'k');
        const done = await store.view(submitted.jobId, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION });
        assert.deepEqual(done, { jobId: submitted.jobId, status: 'completed', markdown: '# pages', pages: 4 });
    });

    it('marks a failed conversion with the shared failure message', async () => {
        const jobs = new MarkdownOcrJobs(async () => { throw new Error('provider down'); }, { store });
        const { jobId } = await jobs.submit(owner, { enabled: true }, imageFile);
        await jobs.drain();
        assert.deepEqual(await store.view(jobId, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION }),
            { jobId, status: 'failed', error: 'Markdown OCR failed.' });
    });

    it('marks an aborted conversion as timed out', async () => {
        const jobs = new MarkdownOcrJobs(async (_c, _f, _onPage, signal) => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.ok(signal.aborted);
            return { markdown: '# late', pages: 1 };
        }, { store, timeoutMs: 10 });
        const { jobId } = await jobs.submit(owner, { enabled: true }, imageFile);
        await jobs.drain();
        assert.deepEqual(await store.view(jobId, owner, { timeoutMs: TIMEOUT, retentionMs: RETENTION }),
            { jobId, status: 'failed', error: 'Markdown OCR timed out.' });
    });
});
