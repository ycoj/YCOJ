import { bench, describe } from 'vitest';
import {
    camelCase, diffArray, formatDate, getAlphabeticId,
    parseMemoryMB, parseTimeMS, size, snakeCase, sortFiles,
} from '../framework/utils/lib/common';

// Time / memory limits are parsed for every testcase of every judged submission.
const timeLimits = ['1s', '1000ms', '2.5s', '500ms', '3000', '1500us', '0.5s', '250ms'];
const memoryLimits = ['256m', '512m', '1g', '128m', '262144k', '64m', '1024m', '32m'];

// A problem with 100 testcases, named the way most problem setters name them.
const testdataFiles: string[] = [];
for (let i = 1; i <= 100; i++) testdataFiles.push(`data${i}.in`, `data${i}.out`);
testdataFiles.push('config.yaml', 'chk.cpp', 'val.cpp');
// Shuffled deterministically so the sort actually has work to do.
const shuffledFiles = testdataFiles.slice().sort((a, b) => (a.length % 7) - (b.length % 7) || (a < b ? 1 : -1));

const fileDocs = shuffledFiles.map((name, idx) => ({ _id: name, size: idx * 137, etag: `etag-${idx}` }));

const arrayA = Array.from({ length: 200 }, (_, i) => `tag-${i}`);
const arrayB = Array.from({ length: 200 }, (_, i) => `tag-${i === 199 ? 'x' : i}`);

const settingObject = {
    problem_edit_time: 1,
    nested_setting_group: {
        first_child_key: 'a',
        second_child_key: [{ deep_nested_key: 1 }, { another_deep_key: 2 }],
    },
    contest_rule_name: 'oi',
    homework_penalty_rate: 0.8,
};

const dates = Array.from({ length: 64 }, (_, i) => new Date(2024, i % 12, (i % 28) + 1, i % 24, i % 60, i % 60));

describe('utils/common', () => {
    bench('parseTimeMS', () => {
        for (const t of timeLimits) parseTimeMS(t);
    });

    bench('parseMemoryMB', () => {
        for (const m of memoryLimits) parseMemoryMB(m);
    });

    bench('sortFiles (200 testdata files)', () => {
        sortFiles(shuffledFiles);
    });

    bench('sortFiles (200 file documents)', () => {
        sortFiles(fileDocs, '_id');
    });

    bench('diffArray (200 entries)', () => {
        diffArray(arrayA.slice(), arrayB.slice());
    });

    bench('formatDate', () => {
        for (const d of dates) formatDate(d);
    });

    bench('size', () => {
        for (let i = 0; i < 64; i++) size(1 << i % 31);
    });

    bench('camelCase/snakeCase on nested settings', () => {
        snakeCase(camelCase(settingObject));
    });

    bench('getAlphabeticId', () => {
        for (let i = 0; i < 1000; i++) getAlphabeticId(i);
    });
});
