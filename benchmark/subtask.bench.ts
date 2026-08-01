import { bench, describe } from 'vitest';
import { convertIniConfig, normalizeSubtasks, readSubtasksFromFiles } from '../packages/common/subtask';

// Flat problem: 100 testcases without explicit subtasks.
const flatFiles: string[] = [];
for (let i = 1; i <= 100; i++) flatFiles.push(`${i}.in`, `${i}.out`);

// Subtask problem: 10 subtasks of 20 testcases each.
const subtaskFiles: string[] = [];
for (let s = 1; s <= 10; s++) {
    for (let i = 1; i <= 20; i++) subtaskFiles.push(`prob${s}_${i}.in`, `prob${s}_${i}.ans`);
}

// Legacy naming, matched by the slowest rule of the matcher.
const legacyFiles: string[] = [];
for (let i = 1; i <= 100; i++) legacyFiles.push(`problem.in${i}`, `problem.ou${i}`);

const parsedSubtasks = readSubtasksFromFiles(subtaskFiles, {});
const iniConfig = [
    '100',
    ...Array.from({ length: 100 }, (_, i) => `${i + 1}.in|${i + 1}.out|1|1|262144`),
].join('\n');

const identity = (name: string) => name;

describe('common/subtask', () => {
    bench('readSubtasksFromFiles (100 flat cases)', () => {
        readSubtasksFromFiles(flatFiles, {});
    });

    bench('readSubtasksFromFiles (10 subtasks x 20 cases)', () => {
        readSubtasksFromFiles(subtaskFiles, {});
    });

    bench('readSubtasksFromFiles (legacy .inN naming)', () => {
        readSubtasksFromFiles(legacyFiles, {});
    });

    // normalizeSubtasks only sorts its input in place and returns fresh objects,
    // so it is safe (and deterministic) to feed it the same parsed subtasks.
    bench('normalizeSubtasks (10 subtasks x 20 cases)', () => {
        normalizeSubtasks(parsedSubtasks, identity, '1s', '256m');
    });

    bench('convertIniConfig (100 cases)', () => {
        convertIniConfig(iniConfig);
    });
});
