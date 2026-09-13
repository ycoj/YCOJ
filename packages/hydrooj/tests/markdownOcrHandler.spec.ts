import assert from 'assert';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { after, before, describe, it } from 'node:test';

function mockModule(request: string, exports: unknown) {
    require.cache[require.resolve(request)] = { exports } as NodeJS.Module;
}

Object.assign(global, { Hydro: { model: {}, ui: {} }, app: { get: () => undefined } });

// Real framework decorators + Handler so arg/route validation runs for real (no Proxy stubs).
mockModule('../src/service/server', require('@hydrooj/framework'));
mockModule('../src/service/db', { collection: () => null });

const { ValidationError, NotFoundError, MarkdownOcrCapacityError } = require('../src/error');
mockModule('../src/model/builtin', { PRIV: { PRIV_USER_PROFILE: 1n }, PERMS: [] });

const VALID_CONFIG = {
    enabled: true,
    profileId: 'p:m',
    apiType: 'openai-completions',
    baseUrl: 'https://api.test/v1',
    model: 'vision-model',
    apiKey: 'secret',
    thinkingLevel: 'high',
    contextTokens: 128_000,
    maxTokens: 32_000,
};
let currentConfig: any = VALID_CONFIG;
mockModule('../src/lib/ai/ocr/runtime', { getMarkdownOcrConfig: () => currentConfig });
mockModule('../src/lib/ai/runtime', { getConfiguredAiModelProfiles: () => [] });

let mongod: MongoMemoryServer;
let client: MongoClient;
let collection: any;
let jobModel: any;
let jobsRunner: any;
let ensureJobIndexes: any;
let handler: any;
let pngFile: any;

before(async () => {
    mongod = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongod.getUri());
    delete require.cache[require.resolve('../src/model/markdownOcrJob')];
    ({ MarkdownOcrJobModel: jobModel, ensureJobIndexes } = require('../src/model/markdownOcrJob'));
    ({ MarkdownOcrJobs: jobsRunner } = require('../src/lib/ai/ocr/jobs'));
    handler = require('../src/handler/markdownOcr');
    const filepath = path.join(os.tmpdir(), `ocr-test-${new ObjectId().toHexString()}.png`);
    await fs.writeFile(filepath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]));
    pngFile = { filepath, mimetype: 'image/png', originalFilename: 'scan.png', size: 11 };
});

after(async () => {
    await fs.remove(pngFile?.filepath);
    await client?.close();
    await mongod?.stop();
});

function makeHandler(HandlerClass: any, uid: number, jobs: any, file?: any) {
    return Object.assign(Object.create(HandlerClass.prototype), {
        user: { _id: uid },
        args: { domainId: 'test' },
        ctx: { get: (name: string) => (name === 'markdownOcrJobs' ? jobs : undefined) },
        request: {
            params: {},
            query: {},
            body: {},
            files: file === undefined ? {} : { file },
        },
        response: {},
    });
}

async function newJobs(capacity: number, capacityPerOwner: number, convert: any) {
    collection = client.db(`ocr-handler-${new ObjectId().toHexString()}`).collection('background_task');
    await ensureJobIndexes(collection);
    // eslint-disable-next-line new-cap
    const store = new jobModel(collection, capacity, capacityPerOwner);
    // eslint-disable-next-line new-cap
    return new jobsRunner(convert, { store, timeoutMs: 1000, retentionMs: 1000 });
}

// The runner reaches the handlers through the markdownOcrJobs service that apply(ctx) provides.
// Tests use the same seam: they hand their runner to apply on a stub context whose provide/get
// mirror the service lookup, and sweep/dispose register on that exact provided instance.
let injected: any;
const disposers: (() => void)[] = [];
async function injectJobs(jobs: any) {
    if (injected === jobs) return;
    for (const dispose of disposers.splice(0)) dispose();
    injected = jobs;
    await handler.apply({
        effect: (cb: any) => { disposers.push(cb()); },
        Route: () => undefined,
        injectUI: () => undefined,
        get: (name: string) => (name === 'markdownOcrJobs' ? jobs : undefined),
        provide: () => undefined,
    });
}

async function submit(jobs: any, uid: number, file: any = pngFile) {
    await injectJobs(jobs);
    const h = makeHandler(handler.MarkdownOcrHandler, uid, jobs, file);
    await h.post({ domainId: 'test' });
    return h;
}

async function pollGet(jobs: any, uid: number, jobId: string) {
    await injectJobs(jobs);
    const poll = makeHandler(handler.MarkdownOcrJobHandler, uid, jobs);
    poll.request.params.jobId = jobId;
    await poll.get({ domainId: 'test', jobId });
    return poll;
}

async function pollUntil(jobs: any, uid: number, jobId: string, done: (body: any) => boolean) {
    for (let i = 0; i < 100; i++) {
        // eslint-disable-next-line no-await-in-loop
        const poll = await pollGet(jobs, uid, jobId);
        if (done(poll.response.body)) return poll;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`poll did not settle for ${jobId}`);
}

describe('Markdown OCR handler contract', () => {
    after(async () => {
        for (const dispose of disposers.splice(0)) dispose();
    });

    it('renders the tool page on GET with the enabled flag', async () => {
        const jobs = await newJobs(100, 10, async () => ({ markdown: '# x', pages: 1 }));
        await injectJobs(jobs);
        const h = makeHandler(handler.MarkdownOcrHandler, 2, jobs);
        await h.get({ domainId: 'test' });
        assert.equal(h.response.template, 'markdown_ocr.html');
        assert.equal(h.response.body.enabled, true);
        assert.deepEqual(h.response.body.profiles, []);
        currentConfig = { enabled: false };
        const off = makeHandler(handler.MarkdownOcrHandler, 2, jobs);
        await off.get({ domainId: 'test' });
        assert.equal(off.response.body.enabled, false);
        currentConfig = VALID_CONFIG;
    });

    it('admits an image upload through POST and returns 202 + job schema', async () => {
        let resolve: (r: any) => void;
        const converted = new Promise<any>((r) => { resolve = r; });
        const jobs = await newJobs(100, 10, () => converted);
        const submitted = await submit(jobs, 2);
        assert.equal(submitted.response.status, 202);
        assert.equal(submitted.response.type, 'application/json');
        assert.deepEqual(Object.keys(submitted.response.body).sort(), ['jobId', 'status']);
        assert.equal(submitted.response.body.status, 'pending');
        const { jobId } = submitted.response.body;
        const first = (await pollGet(jobs, 2, jobId)).response.body;
        assert.ok(['pending', 'running'].includes(first.status), `unexpected first poll: ${first.status}`);
        resolve({ markdown: '# Converted', pages: 1 });
        const done = await pollUntil(jobs, 2, jobId, (body) => body.status === 'completed');
        assert.deepEqual(done.response.body, { jobId, status: 'completed', markdown: '# Converted', pages: 1 });
        assert.equal(done.response.type, 'application/json');
        await jobs.drain();
    });

    it('reports PDF page progress while the job is running', async () => {
        let release: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const jobs = await newJobs(100, 10, async (_c: any, _f: any, onPage: any) => {
            await onPage(2, 7);
            await gate;
            return { markdown: '# pdf', pages: 7 };
        });
        const submitted = await submit(jobs, 2);
        const { jobId } = submitted.response.body;
        const running = await pollUntil(jobs, 2, jobId, (body) => body.status === 'running' && body.progress);
        assert.deepEqual(running.response.body.progress, { done: 2, total: 7 });
        release!();
        await pollUntil(jobs, 2, jobId, (body) => body.status === 'completed');
        await jobs.drain();
    });

    it('rejects a POST without a file and does not admit a job', async () => {
        let calls = 0;
        const jobs = await newJobs(100, 10, () => {
            calls += 1;
            return Promise.resolve({ markdown: '#x', pages: 1 });
        });
        await assert.rejects(submit(jobs, 2, null), (e: any) => e instanceof ValidationError);
        assert.equal(calls, 0);
        await jobs.drain();
    });

    it('rejects oversized and unsupported files before admitting a job', async () => {
        let calls = 0;
        const jobs = await newJobs(100, 10, () => {
            calls += 1;
            return Promise.resolve({ markdown: '#x', pages: 1 });
        });
        await assert.rejects(
            submit(jobs, 2, { ...pngFile, size: 33 * 1024 * 1024 }),
            (e: any) => e instanceof ValidationError,
        );
        const textFile = path.join(os.tmpdir(), `ocr-test-${new ObjectId().toHexString()}.txt`);
        await fs.writeFile(textFile, 'plain text');
        try {
            await assert.rejects(
                submit(jobs, 2, { filepath: textFile, mimetype: 'text/plain', originalFilename: 'a.txt', size: 10 }),
                (e: any) => e instanceof ValidationError,
            );
        } finally {
            await fs.remove(textFile);
        }
        assert.equal(calls, 0);
        await jobs.drain();
    });

    it('returns MarkdownOcrCapacityError (503) once the owner is at capacity', async () => {
        let resolve: (r: any) => void;
        const converted = new Promise<any>((r) => { resolve = r; });
        const jobs = await newJobs(100, 1, () => converted);
        const first = await submit(jobs, 2);
        assert.equal(first.response.status, 202);
        await assert.rejects(submit(jobs, 2),
            (e: any) => e instanceof MarkdownOcrCapacityError && e.code === 503);
        resolve({ markdown: '# done', pages: 1 });
        await jobs.drain();
    });

    it('returns NotFoundError (404) for unknown or foreign-owned jobs', async () => {
        const jobs = await newJobs(100, 10, async () => ({ markdown: '# x', pages: 1 }));
        await assert.rejects(pollGet(jobs, 2, 'unknown-job'), (e: any) => e instanceof NotFoundError && e.code === 404);
        const submitted = await submit(jobs, 2);
        await assert.rejects(pollGet(jobs, 3, submitted.response.body.jobId), NotFoundError);
        await jobs.drain();
    });

    it('registers the documented routes and the user dropdown entry on the shared runner', async () => {
        const routes: { name: string, path: string }[] = [];
        const injectedUi: any[] = [];
        const disposed: any[] = [];
        let provided: any;
        await handler.apply({
            effect: (cb: any) => { disposed.push(cb()); },
            Route: (name: string, routePath: string) => routes.push({ name, path: routePath }),
            injectUI: (section: string, name: string) => injectedUi.push([section, name]),
            get: (name: string) => (name === 'markdownOcrJobs' ? provided : undefined),
            provide: (name: string, value: any) => {
                if (name === 'markdownOcrJobs') provided = value;
            },
        });
        assert.ok(routes.some((route) => route.path === '/tools/markdown-ocr'));
        assert.ok(routes.some((route) => route.path === '/tools/markdown-ocr/:jobId'));
        assert.ok(injectedUi.some(([section, name]) => section === 'UserDropdown' && name === 'markdown_ocr'));
        assert.ok(provided, 'apply provides the runner on the context');
        const { Handler } = require('@hydrooj/framework');
        assert.ok(Object.getPrototypeOf(handler.MarkdownOcrHandler) === Handler);
        assert.ok(Object.getPrototypeOf(handler.MarkdownOcrJobHandler) === Handler);
        for (const dispose of disposed) dispose();
    });
});
