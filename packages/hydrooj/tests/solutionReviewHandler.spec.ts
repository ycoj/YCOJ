/* eslint-disable no-await-in-loop */
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
mockModule('../src/model/builtin', { PERM: { PERM_DELETE_PROBLEM_SOLUTION: 1, PERM_DELETE_PROBLEM_SOLUTION_SELF: 2 }, PRIV: {}, STATUS: {} });
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
const solutionMock = {
    async get() { return { parentId: 2, docId: 'id', owner: 42 }; },
    ensureParent(doc, pid) { if (doc.parentId !== pid) throw new TestError('wrong problem'); },
    async edit() { throw new Error('mutation must not run'); },
    async del() { throw new Error('mutation must not run'); },
    async reply() { throw new Error('mutation must not run'); },
    async vote() { throw new Error('mutation must not run'); },
};
mockModule('../src/model/solution', solutionMock);
mockModule('../src/model/storage', { });
mockModule('../src/model/system', { get: () => 0 });
mockModule('../src/model/task', { });
mockModule('../src/model/user', { });
mockModule('../src/lib/ai/html2md/converter', { });
mockModule('../src/lib/ai/html2md/runtime', { });
mockModule('../src/lib/ai/html2md/validation', { });
mockModule('../src/lib/ai/testdata/policy', { });
mockModule('../src/lib/ai/testdata/request', { });
mockModule('../src/lib/ai/testdata/runtime', { });
mockModule('../src/lib/ai/testdata/trace', { });
mockModule('../src/lib/ai/testdata/validation', { });
mockModule('@hydrooj/utils/lib/search', {});

Object.assign(global, { Hydro: { model: {}, ui: {} } });
const { ProblemSolutionReviewHandler, ProblemSolutionHandler, ProblemSolutionRawHandler } = require('../src/handler/problem');

describe('solution review authorization and problem binding', () => {
    it('requires the non-self solution deletion permission', async () => {
        const handler = Object.create(ProblemSolutionReviewHandler.prototype);
        let granted = 2;
        handler.checkPerm = (perm) => { if (perm !== granted) throw new TestError('forbidden'); };
        await assert.rejects(handler.prepare(), /forbidden/);
        granted = 1;
        await handler.prepare();
    });

    it('rejects mismatched problem IDs before edits, deletes, replies, or votes', async () => {
        const handler = Object.create(ProblemSolutionHandler.prototype);
        handler.pdoc = { docId: 1 };
        handler.user = { _id: 42, hasPerm: () => true };
        handler.checkPerm = () => undefined;
        for (const [method, args] of [
            ['postEditSolution', ['domain', 'content', 'id']],
            ['postDeleteSolution', ['domain', 'id']],
            ['postReply', ['domain', 'id', 'reply']],
            ['postUpvote', ['domain', 'id']],
            ['postDownvote', ['domain', 'id']],
        ]) await assert.rejects(handler[method](...args), /wrong problem/);
    });

    it('rejects mismatched raw solution access', async () => {
        const handler = Object.create(ProblemSolutionRawHandler.prototype);
        handler.pdoc = { docId: 1 };
        handler.user = { _id: 42, hasPerm: () => true };
        handler.checkPerm = () => undefined;
        handler.response = {};
        await assert.rejects(handler.get('domain', 'id'), /wrong problem/);
        assert.equal(handler.response.body, undefined);
    });
});
