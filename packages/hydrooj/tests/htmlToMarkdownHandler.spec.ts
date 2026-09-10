import assert from 'assert';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { after, before, beforeEach, describe, it } from 'node:test';

function mockModule(request: string, exports: unknown) {
    require.cache[require.resolve(request)] = { exports } as NodeJS.Module;
}

Object.assign(global, { Hydro: { model: {}, ui: {} }, app: { get: () => undefined } });

// Real framework decorators + Handler so arg/route validation runs for real (no Proxy stubs).
mockModule('../src/service/server', require('@hydrooj/framework'));
mockModule('../src/service/db', { collection: () => null });

const { ValidationError, PermissionError, NotFoundError, HtmlToMarkdownCapacityError } = require('../src/error');
const { PERM } = { PERM: { PERM_EDIT_PROBLEM: 1n << 6n, PERM_EDIT_PROBLEM_SELF: 1n << 7n, PERM_VIEW_PROBLEM_HIDDEN: 1n << 5n } };
mockModule('../src/model/builtin', { PERM, PERMS: [] });

mockModule('../src/lib/ai/html2md/runtime', { getHtmlToMarkdownConfig: () => ({ enabled: true }) });
mockModule('../src/lib/ai/html2md/validation', { validateHtmlToMarkdownConfig: () => undefined });

let problemStore: Record<string, any> = {};
const problem = {
    get: async (_domainId: string, pid: number | string, projection: string[]) => {
        const doc = problemStore[String(pid)];
        return doc ? Object.fromEntries(projection.map((key) => [key, doc[key]])) : null;
    },
    canViewBy: (pdoc: any, user: any) => !pdoc.hidden || user.own(pdoc) || user.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN),
};
mockModule('../src/model/problem', { __esModule: true, default: problem });

const contest = {
    get: async () => ({ _id: 't1', pids: [1000] }),
    getStatus: async () => ({ attend: true, startAt: new Date() }),
    isNotStarted: () => false,
    isDone: () => false,
};
mockModule('../src/model/contest', contest);

let mongod: MongoMemoryServer;
let client: MongoClient;
let collection: any;
let jobModel: any;
let jobsRunner: any;
let ensureJobIndexes: any;
let handler: any;

before(async () => {
    mongod = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongod.getUri());
    delete require.cache[require.resolve('../src/model/htmlToMarkdownJob')];
    ({ HtmlToMarkdownJobModel: jobModel, ensureJobIndexes } = require('../src/model/htmlToMarkdownJob'));
    ({ HtmlToMarkdownJobs: jobsRunner } = require('../src/lib/ai/html2md/jobs'));
    handler = require('../src/handler/problemHtmlToMarkdown');
});

after(async () => {
    await client?.close();
    await mongod?.stop();
});

class FakeUser {
    _id: number;
    editable: boolean;
    viewerHidden: boolean;
    constructor(uid: number, { editable = true, viewerHidden = false } = {}) {
        this._id = uid;
        this.editable = editable;
        this.viewerHidden = viewerHidden;
    }

    own(doc: any, perm?: bigint) {
        if (perm !== undefined && !this.hasPerm(perm)) return false;
        return doc.owner === this._id || (doc.maintainer || []).includes(this._id);
    }

    hasPerm(...perms: bigint[]) {
        return perms.some((perm) => ([PERM.PERM_EDIT_PROBLEM, PERM.PERM_EDIT_PROBLEM_SELF].includes(perm) && this.editable)
            || (perm === PERM.PERM_VIEW_PROBLEM_HIDDEN && this.viewerHidden));
    }
}

function makeHandler(HandlerClass: any, user: FakeUser, jobs: any, jobId?: string) {
    return Object.assign(Object.create(HandlerClass.prototype), {
        user,
        args: { domainId: 'test' },
        ctx: { get: (name: string) => (name === 'htmlToMarkdownJobs' ? jobs : undefined) },
        request: {
            params: jobId ? { pid: '1000', jobId } : { pid: '1000' },
            query: {},
            body: {},
        },
        response: {},
        checkPerm: (...perms: bigint[]) => { if (!user.hasPerm(...perms)) throw new PermissionError(...perms); },
    });
}

async function newJobs(capacity: number, capacityPerOwner: number, convert: any) {
    collection = client.db(`handler-${new ObjectId().toHexString()}`).collection('background_task');
    await ensureJobIndexes(collection);
    // eslint-disable-next-line new-cap
    const store = new jobModel(collection, capacity, capacityPerOwner);
    // eslint-disable-next-line new-cap
    return new jobsRunner(convert, { store, timeoutMs: 1000, retentionMs: 1000 });
}

// The runner reaches the handlers through the htmlToMarkdownJobs service that apply(ctx) provides.
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
        get: (name: string) => (name === 'htmlToMarkdownJobs' ? jobs : undefined),
        provide: () => undefined,
    });
}

async function submit(jobs: any, user: FakeUser) {
    await injectJobs(jobs);
    const submitHandler = makeHandler(handler.ProblemHtmlToMarkdownSubmitHandler, user, jobs);
    await submitHandler.post({ domainId: 'test' });
    return submitHandler;
}

async function pollGet(jobs: any, user: FakeUser, jobId: string) {
    await injectJobs(jobs);
    const poll = makeHandler(handler.ProblemHtmlToMarkdownHandler, user, jobs, jobId);
    await poll._prepare({ domainId: 'test' });
    await poll.get({ domainId: 'test' });
    return poll;
}

async function pollUntil(jobs: any, user: FakeUser, jobId: string, done: (body: any) => boolean) {
    for (let i = 0; i < 100; i++) {
        // eslint-disable-next-line no-await-in-loop
        const poll = await pollGet(jobs, user, jobId);
        if (done(poll.response.body)) return poll;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`poll did not settle for ${jobId}`);
}

describe('HTML-to-Markdown handler contract', () => {
    beforeEach(async () => {
        problemStore = { 1000: { docId: 1000, owner: 2, hidden: false, content: '<p>Original</p>' } };
    });

    after(async () => {
        for (const dispose of disposers.splice(0)) dispose();
    });

    it('admits through the POST route and returns 202 + job schema', async () => {
        let resolve: (md: string) => void;
        const converted = new Promise<string>((r) => { resolve = r; });
        const jobs = await newJobs(100, 10, () => converted);
        const submitted = await submit(jobs, new FakeUser(2));
        assert.equal(submitted.response.status, 202);
        assert.equal(submitted.response.type, 'application/json');
        assert.deepEqual(Object.keys(submitted.response.body).sort(), ['jobId', 'status']);
        assert.equal(submitted.response.body.status, 'pending');
        const { jobId } = submitted.response.body;

        // Pending is admitted; the in-process claim then moves it to running. Assert the in-flight set.
        const first = (await pollGet(jobs, new FakeUser(2), jobId)).response.body;
        assert.ok(['pending', 'running'].includes(first.status), `unexpected first poll: ${first.status}`);
        resolve('# Converted');
        const done = await pollUntil(jobs, new FakeUser(2), jobId, (body) => body.status === 'completed');
        assert.deepEqual(done.response.body, { jobId, status: 'completed', markdown: '# Converted' });
        assert.equal(done.response.type, 'application/json');
        await jobs.drain();
    });

    it('polls a job persisted by another worker directly from the shared store', async () => {
        let resolve: (md: string) => void;
        const converted = new Promise<string>((r) => { resolve = r; });
        const jobs = await newJobs(100, 10, () => converted);
        const { jobId } = await jobs.submit({ domainId: 'test', pid: 1000, uid: 2 }, {} as any, '<p>x</p>');
        // eslint-disable-next-line new-cap
        const other = new jobModel(collection);
        const persisted = await other.get(jobId, { domainId: 'test', pid: 1000, uid: 2 });
        assert.ok(persisted);
        assert.ok(['pending', 'running'].includes(persisted.status));
        assert.equal(await other.get(jobId, { domainId: 'test', pid: 1000, uid: 3 }), null);
        resolve('# shared');
        await jobs.drain();
    });

    it('allows a maintainer with self-edit permission to submit and poll a hidden problem', async () => {
        problemStore[1000].hidden = true;
        problemStore[1000].maintainer = [3];
        const user = new FakeUser(3);
        user.hasPerm = (...perms: bigint[]) => perms.includes(PERM.PERM_EDIT_PROBLEM_SELF);
        const jobs = await newJobs(100, 10, async () => '# maintained');
        const submitted = await submit(jobs, user);
        assert.equal(submitted.response.status, 202);
        await jobs.drain();
        const poll = await pollGet(jobs, user, submitted.response.body.jobId);
        assert.equal(poll.response.body.markdown, '# maintained');
    });

    it('rejects a non-editor poll with PermissionError (403) before reading the job', async () => {
        const jobs = await newJobs(100, 10, async () => '# x');
        const poll = makeHandler(handler.ProblemHtmlToMarkdownHandler, new FakeUser(99, { editable: false }), jobs, 'any-job');
        await assert.rejects(poll._prepare({ domainId: 'test' }), (e: any) => e instanceof PermissionError && e.code === 403);
        await jobs.drain();
    });

    it('returns NotFoundError (404) for unknown or foreign-owned jobs', async () => {
        const jobs = await newJobs(100, 10, async () => '# x');
        await assert.rejects(pollGet(jobs, new FakeUser(2), 'unknown-job'), (e: any) => e instanceof NotFoundError && e.code === 404);
        const { jobId } = await jobs.submit({ domainId: 'test', pid: 1000, uid: 2 }, {} as any, '<p>x</p>');
        await assert.rejects(pollGet(jobs, new FakeUser(3), jobId), NotFoundError);
        await jobs.drain();
    });

    it('rejects submission without edit permission and does not admit a job', async () => {
        let calls = 0;
        const jobs = await newJobs(100, 10, () => {
            calls += 1;
            return Promise.resolve('#x');
        });
        await assert.rejects(submit(jobs, new FakeUser(3, { editable: false })),
            (e: any) => e instanceof PermissionError && e.code === 403);
        assert.equal(calls, 0);
        await jobs.drain();
    });

    it('fails oversized content with ValidationError before admitting a job', async () => {
        let calls = 0;
        const jobs = await newJobs(100, 10, () => {
            calls += 1;
            return Promise.resolve('#x');
        });
        problemStore[1000] = { docId: 1000, owner: 2, hidden: false, content: 'x'.repeat(200_001) };
        await assert.rejects(submit(jobs, new FakeUser(2)), (e: any) => e instanceof ValidationError);
        assert.equal(calls, 0);
        await jobs.drain();
    });

    it('returns HtmlToMarkdownCapacityError (503) once the owner is at capacity', async () => {
        let resolve: (md: string) => void;
        const converted = new Promise<string>((r) => { resolve = r; });
        const jobs = await newJobs(100, 1, () => converted);
        const first = await submit(jobs, new FakeUser(2));
        assert.equal(first.response.status, 202);
        await assert.rejects(submit(jobs, new FakeUser(2)),
            (e: any) => e instanceof HtmlToMarkdownCapacityError && e.code === 503);
        resolve('# done');
        await jobs.drain();
    });

    it('registers both documented routes with lean handlers on the shared runner', async () => {
        const routes: string[] = [];
        const disposed: any[] = [];
        let provided: any;
        await handler.apply({
            effect: (cb: any) => { disposed.push(cb()); },
            Route: (_name: string, path: string) => routes.push(path),
            get: (name: string) => (name === 'htmlToMarkdownJobs' ? provided : undefined),
            provide: (name: string, value: any) => {
                if (name === 'htmlToMarkdownJobs') provided = value;
            },
        });
        assert.ok(routes.includes('/p/:pid/html-to-markdown'));
        assert.ok(routes.includes('/p/:pid/html-to-markdown/:jobId'));
        assert.ok(provided, 'apply provides the runner on the context');
        const { Handler } = require('@hydrooj/framework');
        assert.ok(Object.getPrototypeOf(handler.ProblemHtmlToMarkdownHandler) === Handler);
        assert.ok(Object.getPrototypeOf(handler.ProblemHtmlToMarkdownSubmitHandler) === Handler);
        for (const dispose of disposed) dispose();
    });
});
