import assert from 'assert';
import { describe, it } from 'node:test';

function mockModule(request: string, exports: unknown) {
    const filename = require.resolve(request);
    require.cache[filename] = { exports } as NodeJS.Module;
}

class TestError extends Error { }

mockModule('../src/error', new Proxy({
    ProblemConfigError: TestError,
    ProblemNotAllowLanguageError: TestError,
    ProblemNotAllowPretestError: TestError,
    ValidationError: TestError,
    FileTooLargeError: TestError,
}, { get: (target, property: string) => target[property] || TestError }));
mockModule('../src/context', {});
mockModule('../src/logger', { Logger: class { warn() { } } });
mockModule('../src/handler/contest', {
    ContestDetailBaseHandler: class { },
});
mockModule('../src/service/server', {
    Handler: class { },
    param: () => (_target: unknown, _name: string, descriptor: PropertyDescriptor) => descriptor,
    post: () => (_target: unknown, _name: string, descriptor: PropertyDescriptor) => descriptor,
    query: () => (_target: unknown, _name: string, descriptor: PropertyDescriptor) => descriptor,
    route: () => (_target: unknown, _name: string, descriptor: PropertyDescriptor) => descriptor,
    Query: () => (_target: unknown, _name: string, descriptor: PropertyDescriptor) => descriptor,
    Types: new Proxy({}, { get: () => (..._args: unknown[]) => ({}) }),
});
mockModule('../src/model/builtin', { PERM: {}, PRIV: {}, STATUS: {} });
mockModule('../src/model/contest', { });
mockModule('../src/model/discussion', { });
mockModule('../src/model/domain', { });
mockModule('../src/model/oplog', { });
const recordMock = { STAT_QUERY: {}, add: async () => ({}) };
mockModule('../src/model/problem', {});
mockModule('../src/model/record', recordMock);
mockModule('../src/model/setting', {
    langs: { 'cc.cc14': {} },
    SETTINGS_BY_KEY: { codeLang: { range: {} } },
});
mockModule('../src/model/solution', { });
mockModule('../src/model/storage', { });
mockModule('../src/model/system', { get: () => 0 });
mockModule('../src/model/task', { });
mockModule('../src/model/user', { });
let resolveConversion: (markdown: string) => void;
let conversions = 0;
mockModule('../src/lib/ai/html2md/converter', {
    MAX_HTML_TO_MARKDOWN_LENGTH: 200_000,
    convertHtmlToMarkdown: async () => {
        conversions++;
        return new Promise<string>((resolve) => { resolveConversion = resolve; });
    },
});
mockModule('../src/lib/ai/html2md/runtime', { getHtmlToMarkdownConfig: () => ({}) });
let invalidConfig = false;
mockModule('../src/lib/ai/html2md/validation', {
    validateHtmlToMarkdownConfig: () => { if (invalidConfig) throw new TestError('invalid config'); },
});
mockModule('../src/lib/ai/testdata/policy', { });
mockModule('../src/lib/ai/testdata/request', { });
mockModule('../src/lib/ai/testdata/runtime', { });
mockModule('../src/lib/ai/testdata/trace', { });
mockModule('../src/lib/ai/testdata/validation', { });
mockModule('@hydrooj/utils/lib/search', {});

Object.assign(global, { Hydro: { model: {}, ui: {} } });
const { ProblemDetailHandler, ProblemHtmlToMarkdownHandler, apply } = require('../src/handler/problem');
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function handler(prototype = ProblemDetailHandler.prototype) {
    return Object.assign(Object.create(prototype), {
        pdoc: { docId: 1, content: '<p>Original</p>' },
        user: { _id: 2, own: () => true },
        checkPerm: () => { throw new TestError('forbidden'); },
        response: {},
    });
}

describe('HTML-to-Markdown API', () => {
    it('returns 202 before conversion finishes and polls without saving the problem', async () => {
        const submit = handler();
        await submit.postHtmlToMarkdown('test');
        assert.equal(submit.response.status, 202);
        assert.equal(submit.response.body.status, 'pending');
        const { jobId } = submit.response.body;
        const poll = handler(ProblemHtmlToMarkdownHandler.prototype);
        await poll.get('test', jobId);
        assert.equal(poll.response.body.status, 'pending');
        await tick();
        await poll.get('test', jobId);
        assert.equal(poll.response.body.status, 'running');
        resolveConversion('# Converted');
        await tick();
        await poll.get('test', jobId);
        assert.deepEqual(poll.response.body, { jobId, status: 'completed', markdown: '# Converted' });
        assert.equal(poll.response.type, 'application/json');
        assert.equal(submit.pdoc.content, '<p>Original</p>');
        poll.user._id = 3;
        await assert.rejects(poll.get('test', jobId), TestError);
        poll.user._id = 2;
        await assert.rejects(poll.get('other', jobId), TestError);
        poll.pdoc.docId = 3;
        await assert.rejects(poll.get('test', jobId), TestError);
        await assert.rejects(poll.get('test', 'missing'), TestError);
    });

    it('checks edit permission on both endpoints and rejects invalid input before conversion', async () => {
        const before = conversions;
        const submit = handler();
        submit.user.own = () => false;
        await assert.rejects(submit.postHtmlToMarkdown('test'), /forbidden/);
        const poll = handler(ProblemHtmlToMarkdownHandler.prototype);
        poll.user.own = () => false;
        await assert.rejects(poll.get('test', 'unknown'), /forbidden/);
        submit.user.own = () => true;
        invalidConfig = true;
        await assert.rejects(submit.postHtmlToMarkdown('test'), /invalid config/);
        invalidConfig = false;
        submit.pdoc.content = 'x'.repeat(200_001);
        await assert.rejects(submit.postHtmlToMarkdown('test'), TestError);
        await tick();
        assert.equal(conversions, before);
    });

    it('accepts non-owner editors and rejects jobs when capacity is exhausted', async () => {
        const submit = handler();
        submit.user.own = () => false;
        submit.checkPerm = () => undefined;
        // One completed job remains from the first test.
        for (let i = 0; i < 99; i++) {
            // eslint-disable-next-line no-await-in-loop
            await submit.postHtmlToMarkdown('test');
            assert.equal(submit.response.status, 202);
        }
        await assert.rejects(submit.postHtmlToMarkdown('test'), TestError);
    });

    it('registers polling and releases jobs on disposal', async () => {
        let dispose: () => void;
        const routes: string[] = [];
        await apply({
            effect: (callback) => { dispose = callback(); },
            Route: (_name, path) => routes.push(path),
            inject: async () => {},
        });
        assert.ok(routes.includes('/p/:pid/html-to-markdown/:jobId'));
        dispose();
    });
});
