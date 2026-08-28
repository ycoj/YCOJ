import assert from 'assert';
import { describe, it } from 'node:test';
import {
    bulkSubmitClaimKey, bulkSubmitItemIdentity, isDuplicateKeyError,
} from '../src/lib/bulkSubmit/claim';
import {
    applyProblemMapping, BulkSubmitDuplicateZipPathError, BulkSubmitMappingError, decideBulkSubmitIdentity,
    dryrunSubmittedFromInspect, indexZipEntriesByNormalizedPath, inspectContestBulkSubmit, parseContestBulkSubmitPaths, parseProblemMapping,
    problemAllowsLang, SKIP_DUPLICATE, SKIP_EMPTY, SKIP_JUNK, SKIP_LANG, SKIP_LAYOUT, SKIP_NAME_MISMATCH, SKIP_NOT_CPP,
    SKIP_PROBLEM_NOT_FOUND, SKIP_TOO_LONG, SKIP_UNMAPPED,
} from '../src/lib/bulkSubmit/inspect';

const judgeDependencyCalls = {
    contest: 0,
    domain: 0,
    problem: 0,
};

function mockRecordDependency(request: string, exports: unknown) {
    const filename = require.resolve(request);
    require.cache[filename] = { exports } as NodeJS.Module;
}

mockRecordDependency('@hydrooj/utils/lib/utils', {
    Logger: class { warn() { } },
});
mockRecordDependency('../src/error', { ProblemNotFoundError: Error });
mockRecordDependency('../src/service/db', {
    collection: () => ({}),
});
mockRecordDependency('../src/utils', {
    ArgMethod: (_target: unknown, _name: string, descriptor: PropertyDescriptor) => descriptor,
    buildProjection: () => ({}),
    Time: {},
});
mockRecordDependency('../src/model/builtin', { STATUS: { STATUS_WAITING: 0 } });
mockRecordDependency('../src/model/contest', {
    updateStatus: async () => { judgeDependencyCalls.contest++; },
});
class MockDomainModel {
    static async incUserInDomain() { judgeDependencyCalls.domain++; }
}
mockRecordDependency('../src/model/domain', MockDomainModel);
mockRecordDependency('../src/model/message', {});
mockRecordDependency('../src/model/problem', {
    inc: async () => { judgeDependencyCalls.problem++; },
});
mockRecordDependency('../src/model/system', {});
mockRecordDependency('../src/model/task', {});

Object.assign(global, { Hydro: { model: {} } });
const RecordModel = require('../src/model/record').default;

describe('contest bulk submit zip layout', () => {
    it('parses contestant/problem/problem.cpp entries', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'alice/apple/apple.cpp',
            'bob/gcd/gcd.cpp',
        ]);
        assert.deepStrictEqual(files, [
            { path: 'alice/apple/apple.cpp', contestant: 'alice', problemName: 'apple' },
            { path: 'bob/gcd/gcd.cpp', contestant: 'bob', problemName: 'gcd' },
        ]);
        assert.deepStrictEqual(skipped, []);
    });

    it('does not treat a single contestant folder as a wrapper', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'alice/apple/apple.cpp',
            'alice/gcd/gcd.cpp',
        ]);
        assert.deepStrictEqual(files.map((f) => f.contestant), ['alice', 'alice']);
        assert.deepStrictEqual(skipped, []);
    });

    it('strips a shared wrapper directory', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'weekly/alice/apple/apple.cpp',
            'weekly/bob/apple/apple.cpp',
        ]);
        assert.deepStrictEqual(files, [
            { path: 'weekly/alice/apple/apple.cpp', contestant: 'alice', problemName: 'apple' },
            { path: 'weekly/bob/apple/apple.cpp', contestant: 'bob', problemName: 'apple' },
        ]);
        assert.deepStrictEqual(skipped, []);
    });

    it('matches .cpp and folder names case-insensitively', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'Alice/Apple/APPLE.CPP',
        ]);
        assert.deepStrictEqual(files, [
            { path: 'Alice/Apple/APPLE.CPP', contestant: 'Alice', problemName: 'Apple' },
        ]);
        assert.deepStrictEqual(skipped, []);
    });

    it('skips junk, non-cpp, layout mismatches, and extra files', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            '__MACOSX/alice/apple/apple.cpp',
            'alice/.DS_Store',
            'alice/apple/main.cpp',
            'alice/apple/notes.txt',
            'readme.cpp',
            'alice/apple/src/apple.cpp',
            'alice/apple/apple.cpp',
        ]);
        assert.deepStrictEqual(files, [
            { path: 'alice/apple/apple.cpp', contestant: 'alice', problemName: 'apple' },
        ]);
        assert.deepStrictEqual(skipped.map((s) => s.reason), [
            SKIP_JUNK,
            SKIP_JUNK,
            SKIP_NAME_MISMATCH,
            SKIP_NOT_CPP,
            SKIP_LAYOUT,
            SKIP_LAYOUT,
        ]);
    });

    it('normalizes backslashes', () => {
        const { files } = parseContestBulkSubmitPaths(['alice\\apple\\apple.cpp']);
        assert.deepStrictEqual(files, [
            { path: 'alice\\apple\\apple.cpp', contestant: 'alice', problemName: 'apple' },
        ]);
    });

    it('parses contestant/problem.cpp in nosubfolder mode', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'alice/apple.cpp',
            'bob/gcd.cpp',
        ], 'nosubfolder');
        assert.deepStrictEqual(files, [
            { path: 'alice/apple.cpp', contestant: 'alice', problemName: 'apple' },
            { path: 'bob/gcd.cpp', contestant: 'bob', problemName: 'gcd' },
        ]);
        assert.deepStrictEqual(skipped, []);
    });

    it('does not treat a single contestant folder as a wrapper in nosubfolder mode', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'alice/apple.cpp',
            'alice/gcd.cpp',
        ], 'nosubfolder');
        assert.deepStrictEqual(files.map((f) => f.contestant), ['alice', 'alice']);
        assert.deepStrictEqual(skipped, []);
    });

    it('strips a shared wrapper directory in nosubfolder mode', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'weekly/alice/apple.cpp',
            'weekly/bob/apple.cpp',
        ], 'nosubfolder');
        assert.deepStrictEqual(files, [
            { path: 'weekly/alice/apple.cpp', contestant: 'alice', problemName: 'apple' },
            { path: 'weekly/bob/apple.cpp', contestant: 'bob', problemName: 'apple' },
        ]);
        assert.deepStrictEqual(skipped, []);
    });

    it('does not reinterpret a subfolder zip as contestants named after problems', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'alice/apple/apple.cpp',
            'alice/gcd/gcd.cpp',
        ], 'nosubfolder');
        assert.deepStrictEqual(files, []);
        assert.deepStrictEqual(skipped.map((s) => s.reason), [SKIP_LAYOUT, SKIP_LAYOUT]);
    });

    it('does not parse nested problem folders in nosubfolder mode', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'alice/apple/apple.cpp',
            'alice/gcd.cpp',
        ], 'nosubfolder');
        assert.deepStrictEqual(files, [
            { path: 'alice/gcd.cpp', contestant: 'alice', problemName: 'gcd' },
        ]);
        assert.deepStrictEqual(skipped.map((s) => s.reason), [SKIP_LAYOUT]);
    });

    it('does not parse flat files in subfolder mode', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'alice/apple.cpp',
            'alice/apple/apple.cpp',
        ], 'subfolder');
        assert.deepStrictEqual(files, [
            { path: 'alice/apple/apple.cpp', contestant: 'alice', problemName: 'apple' },
        ]);
        assert.deepStrictEqual(skipped.map((s) => s.reason), [SKIP_LAYOUT]);
    });

    it('extracts both layouts in auto mode and prefers subfolder files', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'alice/apple.cpp',
            'alice/apple/apple.cpp',
            'alice/gcd.cpp',
            'bob/gcd.cpp',
        ]);
        assert.deepStrictEqual(files, [
            { path: 'alice/apple/apple.cpp', contestant: 'alice', problemName: 'apple' },
            { path: 'alice/apple.cpp', contestant: 'alice', problemName: 'apple' },
            { path: 'alice/gcd.cpp', contestant: 'alice', problemName: 'gcd' },
            { path: 'bob/gcd.cpp', contestant: 'bob', problemName: 'gcd' },
        ]);
        assert.deepStrictEqual(skipped, []);
        const mapped = applyProblemMapping(files, { 1001: 'apple', 1002: 'gcd' });
        assert.deepStrictEqual(mapped.files.map((f) => f.path), [
            'alice/apple/apple.cpp',
            'alice/gcd.cpp',
            'bob/gcd.cpp',
        ]);
        assert.deepStrictEqual(mapped.skipped.map((s) => s.reason), [SKIP_DUPLICATE]);
    });

    it('strips a shared wrapper in auto mode for mixed layouts', () => {
        const { files, skipped } = parseContestBulkSubmitPaths([
            'weekly/alice/apple/apple.cpp',
            'weekly/alice/gcd.cpp',
            'weekly/bob/gcd.cpp',
        ]);
        assert.deepStrictEqual(files, [
            { path: 'weekly/alice/apple/apple.cpp', contestant: 'alice', problemName: 'apple' },
            { path: 'weekly/alice/gcd.cpp', contestant: 'alice', problemName: 'gcd' },
            { path: 'weekly/bob/gcd.cpp', contestant: 'bob', problemName: 'gcd' },
        ]);
        assert.deepStrictEqual(skipped, []);
    });
});

describe('contest bulk submit mapping', () => {
    it('parses pid to zip folder names and rejects unknown pids', () => {
        const mapping = parseProblemMapping('{"1001":"apple","1002":" gcd ","1003":"  "}', [1001, 1002, 1003]);
        assert.deepStrictEqual(mapping, { 1001: 'apple', 1002: 'gcd' });
        assert.throws(() => parseProblemMapping({ 9999: 'apple' }, [1001]), BulkSubmitMappingError);
        assert.throws(() => parseProblemMapping('{}', [1001]), BulkSubmitMappingError);
        assert.throws(() => parseProblemMapping('not-json', [1001]), BulkSubmitMappingError);
        assert.throws(() => parseProblemMapping({ 1001: 'apple', 1002: 'APPLE' }, [1001, 1002]), BulkSubmitMappingError);
        assert.throws(() => parseProblemMapping({ 1001: 'apple', 1002: ' apple ' }, [1001, 1002]), BulkSubmitMappingError);
    });

    it('maps files case-insensitively and reports unmapped or duplicate entries', () => {
        const mapped = applyProblemMapping([
            { path: 'alice/Apple/Apple.cpp', contestant: 'alice', problemName: 'Apple' },
            { path: 'alice/extra/extra.cpp', contestant: 'alice', problemName: 'extra' },
            { path: 'alice/apple/apple.cpp', contestant: 'alice', problemName: 'apple' },
            { path: 'bob/gcd/gcd.cpp', contestant: 'bob', problemName: 'gcd' },
        ], { 1001: 'apple', 1002: 'gcd' });
        assert.deepStrictEqual(mapped.files, [
            { path: 'alice/Apple/Apple.cpp', contestant: 'alice', problemName: 'Apple', pid: 1001 },
            { path: 'bob/gcd/gcd.cpp', contestant: 'bob', problemName: 'gcd', pid: 1002 },
        ]);
        assert.deepStrictEqual(mapped.skipped.map((s) => s.reason), [SKIP_UNMAPPED, SKIP_DUPLICATE]);
    });
});

describe('contest bulk submit identity', () => {
    const real = { _id: 42 };
    const vuser = { _id: -1000 };

    it('covers none/real/vuser/both for each existingUser policy', () => {
        assert.deepStrictEqual(decideBulkSubmitIdentity(null, null, 'vuser'), {
            kind: 'vuser', uid: 0, created: true,
        });
        assert.deepStrictEqual(decideBulkSubmitIdentity(null, null, 'existing'), {
            kind: 'vuser', uid: 0, created: true,
        });
        assert.deepStrictEqual(decideBulkSubmitIdentity(real, null, 'vuser'), {
            kind: 'vuser', uid: 0, created: true, realUid: 42,
        });
        assert.deepStrictEqual(decideBulkSubmitIdentity(real, null, 'existing'), {
            kind: 'user', uid: 42, created: false,
        });
        assert.deepStrictEqual(decideBulkSubmitIdentity(null, vuser, 'vuser'), {
            kind: 'vuser', uid: -1000, created: false,
        });
        assert.deepStrictEqual(decideBulkSubmitIdentity(null, vuser, 'existing'), {
            kind: 'vuser', uid: -1000, created: false,
        });
        assert.deepStrictEqual(decideBulkSubmitIdentity(real, vuser, 'vuser'), {
            kind: 'vuser', uid: -1000, created: false, realUid: 42,
        });
        assert.deepStrictEqual(decideBulkSubmitIdentity(real, vuser, 'existing'), {
            kind: 'user', uid: 42, created: false,
        });
    });
});

describe('contest bulk submit inspect', () => {
    const files = [{
        path: 'alice/apple/apple.cpp', contestant: 'alice', problemName: 'apple', pid: 1001,
    }];

    async function runInspect(overrides: Partial<Parameters<typeof inspectContestBulkSubmit>[0]> = {}) {
        return inspectContestBulkSubmit({
            groups: [{ uname: 'alice', files }],
            skipped: [],
            policy: 'vuser',
            pdict: { 1001: { config: { type: 'default' } } },
            submitLang: 'cc.cc14',
            lengthLimit: 100,
            lookupAccounts: async () => ({ real: null, vuser: null }),
            hasSource: () => true,
            readSource: async () => 'int main(){}\n',
            allowsLang: () => true,
            ...overrides,
        });
    }

    it('rejects an explicitly empty problem language list', () => {
        assert.equal(problemAllowsLang({ config: { type: 'default', langs: [] } }, 'cc.cc14'), false);
        assert.equal(problemAllowsLang({ config: { type: 'default' } }, 'cc.cc14'), true);
    });

    it('skips missing problem, disallowed language, missing source, empty, too long, and read errors', async () => {
        const missingProblem = await runInspect({ pdict: {} });
        assert.deepStrictEqual(missingProblem.skipped.map((s) => s.reason), [SKIP_PROBLEM_NOT_FOUND]);
        assert.deepStrictEqual(missingProblem.ready, []);

        const lang = await runInspect({ allowsLang: () => false });
        assert.deepStrictEqual(lang.skipped.map((s) => s.reason), [SKIP_LANG]);

        const emptyLang = await runInspect({
            pdict: { 1001: { config: { type: 'default', langs: [] } } },
            allowsLang: problemAllowsLang,
        });
        assert.deepStrictEqual(emptyLang.skipped.map((s) => s.reason), [SKIP_LANG]);

        const missing = await runInspect({ hasSource: () => false });
        assert.deepStrictEqual(missing.skipped.map((s) => s.reason), [SKIP_LAYOUT]);

        const empty = await runInspect({ readSource: async () => '  \n' });
        assert.deepStrictEqual(empty.skipped.map((s) => s.reason), [SKIP_EMPTY]);

        const tooLong = await runInspect({ lengthLimit: 3, readSource: async () => 'int main(){}\n' });
        assert.deepStrictEqual(tooLong.skipped.map((s) => s.reason), [SKIP_TOO_LONG]);

        const readFail = await runInspect({ readSource: async () => { throw new Error('boom'); } });
        assert.deepStrictEqual(readFail.skipped.map((s) => s.reason), ['boom']);
    });

    it('reports planned vuser uid 0 and ready source without mutations', async () => {
        const inspect = await runInspect();
        assert.deepStrictEqual(inspect.usersPreview, [{
            uname: 'alice', kind: 'vuser', uid: 0, created: true,
        }]);
        assert.deepStrictEqual(inspect.ready, [{
            uname: 'alice', pid: 1001, problemName: 'apple', code: 'int main(){}\n',
        }]);
        assert.deepStrictEqual(dryrunSubmittedFromInspect(inspect), [
            { uname: 'alice', uid: 0, pid: 1001 },
        ]);
    });
});

describe('contest bulk submit zip path uniqueness', () => {
    it('indexes unique normalized paths', () => {
        const map = indexZipEntriesByNormalizedPath([
            { filename: 'alice/apple.cpp', id: 1 },
            { filename: 'bob/gcd.cpp', id: 2 },
        ]);
        assert.equal(map.get('alice/apple.cpp')?.id, 1);
        assert.equal(map.get('bob/gcd.cpp')?.id, 2);
    });

    it('rejects archives whose entries collide after normalizeZipPath', () => {
        const collisions = [
            ['alice/apple.cpp', 'alice\\apple.cpp'],
            ['alice/apple.cpp', '/alice/apple.cpp'],
            ['alice/apple.cpp', 'alice//apple.cpp'],
        ];
        for (const filenames of collisions) {
            assert.throws(
                () => indexZipEntriesByNormalizedPath(filenames.map((filename) => ({ filename }))),
                (e: unknown) => e instanceof BulkSubmitDuplicateZipPathError && e.path === 'alice/apple.cpp',
            );
        }
    });
});

describe('contest bulk submit claim', () => {
    it('derives a stable key from domain, contest, problem, user, and source', () => {
        const item = bulkSubmitItemIdentity('int main(){}\n');
        const key = bulkSubmitClaimKey('system', '665f00000000000000000001', 1001, -1000, item);
        assert.equal(key, bulkSubmitClaimKey('system', '665f00000000000000000001', 1001, -1000, item));
        assert.notEqual(key, bulkSubmitClaimKey('system', '665f00000000000000000001', 1001, -1000, bulkSubmitItemIdentity('int main(){}')));
        assert.notEqual(key, bulkSubmitClaimKey('system', '665f00000000000000000001', 1002, -1000, item));
        assert.notEqual(key, bulkSubmitClaimKey('system', '665f00000000000000000001', 1001, -1001, item));
    });

    it('detects Mongo duplicate-key errors', () => {
        assert.equal(isDuplicateKeyError({ code: 11000 }), true);
        assert.equal(isDuplicateKeyError({ code: 11001 }), false);
        assert.equal(isDuplicateKeyError('duplicate'), false);
    });
});

describe('judge record addition', () => {
    const rid = { toHexString: () => 'new' };
    const claimed = { toHexString: () => 'existing' };

    it('updates submission state after inserting a record', async (t) => {
        judgeDependencyCalls.contest = 0;
        judgeDependencyCalls.domain = 0;
        judgeDependencyCalls.problem = 0;
        const add = t.mock.method(RecordModel, 'add', async () => rid);
        const contestId = { toHexString: () => 'contest' };
        const files = { code: 'stored.cpp' };
        const result = await RecordModel.addJudge(
            'system', 1001, -1000, 'cc.cc14', 'int main(){}',
            {
                contest: contestId, files, claimKey: 'claim',
            },
        );
        assert.equal(result, rid);
        assert.deepStrictEqual(add.mock.calls[0].arguments, [
            'system', 1001, -1000, 'cc.cc14', 'int main(){}', true,
            {
                contest: contestId, files, type: 'judge', claimKey: 'claim',
            },
        ]);
        assert.deepStrictEqual(judgeDependencyCalls, {
            contest: 1,
            domain: 1,
            problem: 1,
        });
    });

    it('returns the claimed record without updating submission state again', async (t) => {
        judgeDependencyCalls.contest = 0;
        judgeDependencyCalls.domain = 0;
        judgeDependencyCalls.problem = 0;
        t.mock.method(RecordModel, 'add', async () => {
            throw Object.assign(new Error('duplicate key'), { code: 11000 });
        });
        t.mock.method(RecordModel, 'getByClaimKey', async () => ({ _id: claimed }));
        const result = await RecordModel.addJudge(
            'system', 1001, -1000, 'cc.cc14', 'int main(){}', { claimKey: 'claim' },
        );
        assert.equal(result, claimed);
        assert.deepStrictEqual(judgeDependencyCalls, {
            contest: 0,
            domain: 0,
            problem: 0,
        });
    });

    it('rethrows post-insert update failures after persisting the record', async (t) => {
        t.mock.method(RecordModel, 'add', async () => rid);
        t.mock.method(MockDomainModel, 'incUserInDomain', async () => {
            throw new Error('nSubmit failed');
        });
        await assert.rejects(
            () => RecordModel.addJudge('system', 1001, -1000, 'cc.cc14', 'int main(){}'),
            /nSubmit failed/,
        );
    });

    it('rethrows insert errors that cannot resolve to an existing claim', async (t) => {
        t.mock.method(RecordModel, 'add', async () => {
            throw new Error('disk full');
        });
        await assert.rejects(
            () => RecordModel.addJudge('system', 1001, -1000, 'cc.cc14', 'int main(){}'),
            /disk full/,
        );
    });

    it('rethrows a duplicate-key error when its claim cannot be found', async (t) => {
        t.mock.method(RecordModel, 'add', async () => {
            throw Object.assign(new Error('duplicate key'), { code: 11000 });
        });
        t.mock.method(RecordModel, 'getByClaimKey', async () => null);
        await assert.rejects(
            () => RecordModel.addJudge(
                'system', 1001, -1000, 'cc.cc14', 'int main(){}', { claimKey: 'claim' },
            ),
            /duplicate key/,
        );
    });
});
