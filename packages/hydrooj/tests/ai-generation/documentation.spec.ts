import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { after, describe, it } from 'node:test';
import { copyCyaronDocsToSession } from '../../src/lib/aiGeneration/documentation';
import type { GoJudgeSessionClient } from '../../src/lib/aiGeneration/session';

describe('CYaRon documentation copy', () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydro-cyaron-docs-'));
    after(() => fs.rmSync(sourceDir, { recursive: true, force: true }));

    it('copies nested Wiki files into the sandbox and excludes Git metadata', async () => {
        fs.mkdirSync(path.join(sourceDir, 'guides'));
        fs.writeFileSync(path.join(sourceDir, 'Home.md'), '# CYaRon\n');
        fs.writeFileSync(path.join(sourceDir, 'guides', 'IO.md'), '# IO\n');
        fs.writeFileSync(path.join(sourceDir, '.git'), 'gitdir: elsewhere\n');

        const files = new Map<string, string>();
        const client = {
            async writeFile(sessionId: string, filepath: string, content: Buffer) {
                assert.equal(sessionId, 'sess');
                files.set(filepath, content.toString());
            },
        } as unknown as GoJudgeSessionClient;

        await copyCyaronDocsToSession(client, 'sess', { sourceDir });

        assert.deepEqual([...files], [
            ['docs/cyaron/guides/IO.md', '# IO\n'],
            ['docs/cyaron/Home.md', '# CYaRon\n'],
        ]);
    });
});
