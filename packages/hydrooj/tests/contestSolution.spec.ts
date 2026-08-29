import assert from 'assert';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';

const calls: any[] = [];
const listeners: Record<string, Function> = {};
const documentMock = {
    TYPE_CONTEST: 30,
    TYPE_CONTEST_SOLUTION: 33,
    add: async (...args: any[]) => { calls.push(['add', ...args]); return args[5] || new ObjectId(); },
    get: async () => null,
    getMulti: () => ({
        sort: () => ({}),
        project: () => ({ toArray: async () => [] }),
    }),
    count: async (...args: any[]) => { calls.push(['count', ...args]); return 0; },
    deleteMulti: async (...args: any[]) => { calls.push(['deleteMulti', ...args]); },
    deleteMultiStatus: async (...args: any[]) => { calls.push(['deleteMultiStatus', ...args]); },
};

const documentPath = require.resolve('../src/model/document');
const busPath = require.resolve('../src/service/bus');
require.cache[documentPath] = { exports: documentMock } as NodeJS.Module;
require.cache[busPath] = { exports: { on: (name: string, fn: Function) => { listeners[name] = fn; }, parallel: async () => {} } } as NodeJS.Module;
Object.assign(global, { Hydro: { model: {} } });
const ContestSolutionModel = require('../src/model/contest/solution').default;

describe('contest solutions', () => {
    it('creates solutions under the contest parent type', async () => {
        calls.length = 0;
        const tid = new ObjectId();
        await ContestSolutionModel.add('system', tid, 42, 'answer');
        assert.deepStrictEqual(calls[0], ['add', 'system', 'answer', 42, 33, null, 30, tid, { reply: [], vote: 0 }]);
    });

    it('registers contest deletion cleanup', async () => {
        calls.length = 0;
        await listeners['contest/del']('system', new ObjectId());
        assert.equal(calls.some((call) => call[0] === 'deleteMulti'), false);
    });
});
