import assert from 'assert';
import { describe, it } from 'node:test';
import {
    applyProblemMapping, BulkSubmitMappingError, parseContestBulkSubmitPaths, parseProblemMapping,
    SKIP_DUPLICATE, SKIP_JUNK, SKIP_LAYOUT, SKIP_NAME_MISMATCH, SKIP_NOT_CPP, SKIP_UNMAPPED,
} from '../src/lib/contestBulkSubmit';

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
});

describe('contest bulk submit mapping', () => {
    it('parses pid to zip folder names and rejects unknown pids', () => {
        const mapping = parseProblemMapping('{"1001":"apple","1002":" gcd "}', [1001, 1002, 1003]);
        assert.deepStrictEqual(mapping, { 1001: 'apple', 1002: 'gcd' });
        assert.throws(() => parseProblemMapping({ 9999: 'apple' }, [1001]), BulkSubmitMappingError);
        assert.throws(() => parseProblemMapping('{}', [1001]), BulkSubmitMappingError);
        assert.throws(() => parseProblemMapping('not-json', [1001]), BulkSubmitMappingError);
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
