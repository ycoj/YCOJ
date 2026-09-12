import assert from 'assert';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import serializer from '../../../framework/framework/serializer';

function mockModule(request: string, exports: unknown) {
    require.cache[require.resolve(request)] = { exports } as NodeJS.Module;
}
class PermissionError extends Error { }
mockModule('../src/error', { PermissionError });
mockModule('../src/model/builtin', { PERM: { PERM_EDIT_CONTEST: 1n } });
let scoreboardCalls = 0;
let statusCalls = 0;
let config;
let query;
let requestedFields;
const tid = new ObjectId();
const lockAt = new Date('2026-09-01T02:00:00Z');
const before = ObjectId.createFromTime(new Date('2026-09-01T01:00:00Z').getTime() / 1000);
const after = ObjectId.createFromTime(new Date('2026-09-01T03:00:00Z').getTime() / 1000);
const tdoc = { _id: tid, domainId: 'test', pids: [1000], lockAt };
mockModule('../src/model/contest', {
    async getScoreboard(_domain, _tid, options) {
        scoreboardCalls++;
        config = options;
        return [tdoc, [], { 2: {}, 3: {} }, {}];
    },
    getMultiStatus(_domain, filter) {
        statusCalls++;
        query = filter;
        return { toArray: async () => [{ uid: 2, journal: [
            { rid: after, pid: 1000, status: 1, score: 100 },
            { rid: before, pid: 1000, status: 2, score: 0 },
            { rid: before, pid: 9999, status: 1, score: 100 },
        ] }] };
    },
});
mockModule('../src/model/user', {
    async getListForRender(_domain, _uids, fields) {
        requestedFields = fields;
        return {
            2: {
                _id: 2, uname: 'alice', avatar: '', realName: '张三', mail: 'private@example.com',
                hash: 'secret', serialize: () => ({ uname: 'alice' }),
            },
            3: { _id: 3, uname: 'bob', avatar: '' },
        };
    },
});
const { getScoreboardExport } = require('../src/handler/contest/scoreboardExport');
const handler = (owner: boolean, editor = false) => ({ user: { own: () => owner, hasPerm: () => editor } });

beforeEach(() => {
    scoreboardCalls = 0;
    statusCalls = 0;
});
describe('scoreboard export JSON', () => {
    it('preserves real names through the actual serializer without leaking private fields', async () => {
        const result = await getScoreboardExport.call(handler(true), tdoc, false);
        const json = JSON.parse(JSON.stringify(result, serializer(false, handler(true) as never)));
        assert.deepStrictEqual(json.udict[2], { _id: 2, uname: 'alice', avatar: '', realName: '张三' });
        assert.equal(json.udict[3].realName, '');
        assert.deepStrictEqual(requestedFields, ['realName']);
        assert.equal(statusCalls, 0);
    });
    it('rejects unauthorized viewers before reading private data', async () => {
        await assert.rejects(getScoreboardExport.call(handler(false), tdoc, true), PermissionError);
        assert.equal(scoreboardCalls, 0);
        assert.equal(statusCalls, 0);
    });
    it('groups all visible attempts and includes empty participants with a contest-scoped query', async () => {
        const result = await getScoreboardExport.call(handler(false, true), tdoc, true);
        assert.deepStrictEqual(query, { docId: tid, attend: { $gt: 0 }, uid: { $in: [2, 3] } });
        assert.equal(result.submissions[2].length, 1);
        assert.equal(result.submissions[2][0].rid, before);
        assert.deepStrictEqual(result.submissions[3], []);
        assert.equal(config.lockAt, lockAt);
    });
    it('includes post-lock attempts after unlocking and orders them chronologically', async () => {
        const result = await getScoreboardExport.call(handler(true), { ...tdoc, unlocked: true }, true);
        assert.equal(config.lockAt, undefined);
        assert.deepStrictEqual(result.submissions[2].map((entry) => entry.rid), [before, after]);
    });
});
