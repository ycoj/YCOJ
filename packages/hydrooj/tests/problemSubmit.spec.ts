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
const { ProblemSubmitHandler } = require('../src/handler/problem') as typeof import('../src/handler/problem');
const record = recordMock;

describe('problem submit endpoint', () => {
    it('propagates post-insert counter failures', async () => {
        const failure = new Error('nSubmit failed');
        record.add = async () => { throw failure; };
        const handler = Object.create(ProblemSubmitHandler.prototype) as any;
        handler.pdoc = {
            docId: 1001,
            config: { type: 'default', langs: ['cc.cc14'] },
        };
        handler.user = { _id: 42 };
        handler.response = { body: {} };
        handler.request = { files: null };
        handler.limitRate = async () => { };
        handler.url = () => '/record/new';

        await assert.rejects(
            () => handler.post('system', 'cc.cc14', 'int main(){}', false, [], undefined),
            (error) => error === failure,
        );
        assert.deepStrictEqual(handler.response.body, {});
    });
});
