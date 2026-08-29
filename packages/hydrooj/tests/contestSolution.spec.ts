import assert from 'assert';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';

const calls: any[] = [];
const listeners: Record<string, Function> = {};
const solutions: any[] = [];
const statuses: any[] = [];
const documentMock = {
    TYPE_CONTEST: 30,
    TYPE_CONTEST_SOLUTION: 33,
    add: async (...args: any[]) => {
        calls.push(['add', ...args]);
        const docId = args[4] || new ObjectId();
        solutions.push({ domainId: args[0], content: args[1], owner: args[2], docType: args[3], docId, parentType: args[5], parentId: args[6], ...args[7] });
        return docId;
    },
    get: async (domainId: string, docType: number, docId: ObjectId) => solutions.find((doc) => doc.domainId === domainId && doc.docType === docType && doc.docId.toString() === docId.toString()) || null,
    getMulti: (domainId: string, docType: number, query: any = {}) => {
        const cursor = {
            sort: () => cursor,
            project: () => ({
                toArray: async () => solutions.filter((doc) => doc.domainId === domainId && doc.docType === docType && doc.parentType === query.parentType && doc.parentId.toString() === query.parentId.toString()).map((doc) => ({ docId: doc.docId })),
            }),
        };
        return cursor;
    },
    count: async (...args: any[]) => { calls.push(['count', ...args]); return 0; },
    deleteMulti: async (domainId: string, docType: number, query: any) => {
        calls.push(['deleteMulti', domainId, docType, query]);
        const ids = query.docId.$in.map((id: ObjectId) => id.toString());
        for (let i = solutions.length - 1; i >= 0; i--) {
            if (solutions[i].domainId === domainId && solutions[i].docType === docType && ids.includes(solutions[i].docId.toString())) solutions.splice(i, 1);
        }
    },
    deleteMultiStatus: async (domainId: string, docType: number, query: any) => {
        calls.push(['deleteMultiStatus', domainId, docType, query]);
        const ids = query.docId.$in.map((id: ObjectId) => id.toString());
        for (let i = statuses.length - 1; i >= 0; i--) {
            if (statuses[i].domainId === domainId && statuses[i].docType === docType && ids.includes(statuses[i].docId.toString())) statuses.splice(i, 1);
        }
    },
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
        solutions.length = 0;
        statuses.length = 0;
        const tid = new ObjectId();
        const csid = await ContestSolutionModel.add('system', tid, 42, 'answer');
        statuses.push({ domainId: 'system', docType: documentMock.TYPE_CONTEST_SOLUTION, docId: csid, uid: 42, vote: 1 });

        await listeners['contest/del']('system', tid);

        assert.equal(await documentMock.get('system', documentMock.TYPE_CONTEST_SOLUTION, csid), null);
        assert.equal(statuses.some((status) => status.docId.toString() === csid.toString()), false);
    });
});
