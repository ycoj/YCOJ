import assert from 'assert';
import { describe, it } from 'node:test';
import {
    ArtifactValidationError, collectOutputArtifacts, replaceTestdataWithRollback,
} from '../../src/lib/ai/testdata/artifacts';
import type { GoJudgeSessionClient } from '../../src/lib/ai/testdata/session';

const CONFIG = `time: 1s
memory: 256m
subtasks:
  - score: 100
    cases:
      - input: case1.in
        output: case1.out
`;

function configWithScores(scores: (number | string | null)[]) {
    const subtasks = scores.map((score) => [
        '  -',
        ...(score === null ? [] : [`    score: ${score}`]),
        '    cases:',
        '      - input: case1.in',
        '        output: case1.out',
    ].join('\n')).join('\n');
    return `time: 1s\nmemory: 256m\nsubtasks:\n${subtasks}\n`;
}

function fakeClient(source: Record<string, string>) {
    return {
        async listFiles() {
            return Object.entries(source).map(([name, value]) => ({ name, size: Buffer.byteLength(value), modTime: 1 }));
        },
        async readFile(_sessionId: string, name: string) {
            return Buffer.from(source[name]);
        },
    } as unknown as GoJudgeSessionClient;
}

describe('AI output artifact validation', () => {
    it('accepts paired files and a valid Hydro config', async () => {
        const artifacts = await collectOutputArtifacts(fakeClient({
            'output/config.yaml': CONFIG,
            'output/case1.in': '1\n',
            'output/case1.out': '2\n',
        }), 'sess', { maxFiles: 10, maxBytes: 1024 });
        assert.equal(artifacts.caseCount, 1);
        assert.deepEqual([...artifacts.files.keys()].sort(), ['case1.in', 'case1.out', 'config.yaml']);
    });

    it('rejects missing pairs', async () => {
        await assert.rejects(collectOutputArtifacts(fakeClient({
            'output/config.yaml': CONFIG,
            'output/case1.in': '1\n',
        }), 'sess', { maxFiles: 10, maxBytes: 1024 }), ArtifactValidationError);
    });

    it('rejects invalid configuration and output limits', async () => {
        await assert.rejects(collectOutputArtifacts(fakeClient({
            'output/config.yaml': 'subtasks: [',
            'output/case1.in': '1\n',
            'output/case1.out': '2\n',
        }), 'sess', { maxFiles: 10, maxBytes: 1024 }), /Invalid config/);
        await assert.rejects(collectOutputArtifacts(fakeClient({
            'output/config.yaml': CONFIG,
            'output/case1.in': 'x'.repeat(100),
            'output/case1.out': '2\n',
        }), 'sess', { maxFiles: 10, maxBytes: 20 }), /too large/);
    });

    it('validates requested judge limits and accepts a nearby testcase count', async () => {
        const artifacts = await collectOutputArtifacts(fakeClient({
            'output/config.yaml': CONFIG,
            'output/case1.in': '1\n',
            'output/case1.out': '2\n',
        }), 'sess', { maxFiles: 10, maxBytes: 1024 }, {
            timeLimitMs: 1000,
            memoryLimitMb: 256,
        });
        assert.equal(artifacts.caseCount, 1);
        await assert.rejects(collectOutputArtifacts(fakeClient({
            'output/config.yaml': CONFIG,
            'output/case1.in': '1\n',
            'output/case1.out': '2\n',
        }), 'sess', { maxFiles: 10, maxBytes: 1024 }, {
            timeLimitMs: 2000,
            memoryLimitMb: 256,
        }), /time limit must be exactly 2000ms/);
    });

    it('accepts an exact provided Testlib checker and rejects checker drift', async () => {
        const checkerSource = '#include "testlib.h"\nint main() { return 0; }\n';
        const config = `${CONFIG}checker_type: testlib\nchecker:\n  file: checker.cc\n  lang: cc.cc17\n`;
        const source = {
            'output/config.yaml': config,
            'output/case1.in': '1\n',
            'output/case1.out': '2\n',
            'output/checker.cc': checkerSource,
        };
        const artifacts = await collectOutputArtifacts(
            fakeClient(source), 'sess', { maxFiles: 10, maxBytes: 4096 }, {
                checker: { mode: 'provided', source: checkerSource },
            },
        );
        assert.equal(artifacts.files.get('checker.cc').toString(), checkerSource);
        await assert.rejects(collectOutputArtifacts(
            fakeClient({ ...source, 'output/checker.cc': `${checkerSource}// changed\n` }),
            'sess', { maxFiles: 10, maxBytes: 4096 }, {
                checker: { mode: 'provided', source: checkerSource },
            },
        ), /was modified/);
    });

    it('accepts a generated Testlib checker and rejects invalid checker configuration', async () => {
        const source = {
            'output/config.yaml': `${CONFIG}checker_type: testlib\nchecker:\n  file: checker.cc\n  lang: cc.cc17\n`,
            'output/case1.in': '1\n',
            'output/case1.out': '2\n',
            'output/checker.cc': '#include "testlib.h"\nint main() { return 0; }\n',
        };
        await collectOutputArtifacts(
            fakeClient(source), 'sess', { maxFiles: 10, maxBytes: 4096 }, {
                checker: { mode: 'generated', requirements: 'Accept a valid witness.' },
            },
        );
        await assert.rejects(collectOutputArtifacts(
            fakeClient({
                ...source,
                'output/config.yaml': `${CONFIG}checker_type: testlib\nchecker: checker.cc\n`,
            }),
            'sess', { maxFiles: 10, maxBytes: 4096 }, {
                checker: { mode: 'generated', requirements: 'Accept a valid witness.' },
            },
        ), /must reference checker.cc/);
    });

    it('requires subtask scores to total 100', async () => {
        await assert.rejects(collectOutputArtifacts(fakeClient({
            'output/config.yaml': CONFIG.replace('score: 100', 'score: 90'),
            'output/case1.in': '1\n',
            'output/case1.out': '2\n',
        }), 'sess', { maxFiles: 10, maxBytes: 1024 }), /must total 100/);
    });

    it('accepts multiple subtasks with valid positive integer scores', async () => {
        const artifacts = await collectOutputArtifacts(fakeClient({
            'output/config.yaml': configWithScores([20, 30, 50]),
            'output/case1.in': '1\n',
            'output/case1.out': '2\n',
        }), 'sess', { maxFiles: 10, maxBytes: 1024 });
        assert.equal(artifacts.caseCount, 1);
    });

    it('rejects invalid individual subtask scores even when they total 100', async () => {
        const invalidConfigs = [
            configWithScores([150, -50]),
            configWithScores([50.5, 49.5]),
            configWithScores(['"10"', 90]),
            configWithScores([null, 100]),
        ];
        for (const config of invalidConfigs) {
            // eslint-disable-next-line no-await-in-loop
            await assert.rejects(collectOutputArtifacts(fakeClient({
                'output/config.yaml': config,
                'output/case1.in': '1\n',
                'output/case1.out': '2\n',
            }), 'sess', { maxFiles: 10, maxBytes: 1024 }), /must be positive integers/);
        }
    });

    it('rejects custom checker artifacts in ordinary comparison mode', async () => {
        await assert.rejects(collectOutputArtifacts(fakeClient({
            'output/config.yaml': CONFIG,
            'output/case1.in': '1\n',
            'output/case1.out': '2\n',
            'output/checker.cc': 'int main() {}\n',
        }), 'sess', { maxFiles: 10, maxBytes: 4096 }), /Unexpected output artifact/);
    });
});

describe('AI testdata replacement', () => {
    it('replaces all previous files after successful staging', async () => {
        const files = new Map<string, Buffer>([['old.in', Buffer.from('old')]]);
        await replaceTestdataWithRollback({
            async list() { return [...files.keys()]; },
            async backup(names) { return new Map(names.map((name) => [name, files.get(name)!])); },
            async restore(backup) {
                files.clear();
                for (const [name, content] of backup) files.set(name, content);
            },
            async discard() { return undefined; },
            async put(name, content) { files.set(name, content); },
            async delete(names) { for (const name of names) files.delete(name); },
        }, new Map([
            ['config.yaml', Buffer.from(CONFIG)],
            ['case1.in', Buffer.from('1\n')],
            ['case1.out', Buffer.from('2\n')],
        ]));
        assert.deepEqual([...files.keys()].sort(), ['case1.in', 'case1.out', 'config.yaml']);
    });

    it('restores the complete previous set when replacement fails', async () => {
        const original = new Map<string, Buffer>([
            ['config.yaml', Buffer.from('old-config')],
            ['old.in', Buffer.from('old-input')],
            ['old.out', Buffer.from('old-output')],
        ]);
        const files = new Map(original);
        let failed = false;
        await assert.rejects(replaceTestdataWithRollback({
            async list() { return [...files.keys()]; },
            async backup(names) { return new Map(names.map((name) => [name, files.get(name)!])); },
            async restore(backup) {
                files.clear();
                for (const [name, content] of backup) files.set(name, content);
            },
            async discard() { return undefined; },
            async put(name, content) {
                if (name === 'new.out' && !failed) {
                    failed = true;
                    throw new Error('upload failed');
                }
                files.set(name, content);
            },
            async delete(names) { for (const name of names) files.delete(name); },
        }, new Map([
            ['config.yaml', Buffer.from('new-config')],
            ['new.in', Buffer.from('new-input')],
            ['new.out', Buffer.from('new-output')],
        ])), /upload failed/);
        assert.deepEqual(
            [...files].map(([name, content]) => [name, content.toString()]).sort(),
            [...original].map(([name, content]) => [name, content.toString()]).sort(),
        );
    });

    it('rolls back when cancellation arrives during replacement', async () => {
        const controller = new AbortController();
        const original = new Map<string, Buffer>([['old.in', Buffer.from('old')]]);
        const files = new Map(original);
        await assert.rejects(replaceTestdataWithRollback({
            async list() { return [...files.keys()]; },
            async backup(names) { return new Map(names.map((name) => [name, files.get(name)!])); },
            async restore(backup) {
                files.clear();
                for (const [name, content] of backup) files.set(name, content);
            },
            async discard() { return undefined; },
            async put(name, content) {
                files.set(name, content);
                controller.abort('cancelled');
            },
            async delete(names) { for (const name of names) files.delete(name); },
        }, new Map([
            ['new.in', Buffer.from('new-input')],
            ['new.out', Buffer.from('new-output')],
        ]), controller.signal));
        assert.deepEqual(
            [...files].map(([name, content]) => [name, content.toString()]),
            [...original].map(([name, content]) => [name, content.toString()]),
        );
    });
});
