import fs from 'fs';
import path from 'path';
import { findFileSync } from '@hydrooj/utils';
import type { GoJudgeSessionClient } from './session';

interface CopyCyaronDocsOptions {
    signal?: AbortSignal;
    sourceDir?: string;
}

async function listDocumentationFiles(root: string, relativeDir = ''): Promise<string[]> {
    const entries = await fs.promises.readdir(path.join(root, relativeDir), { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === '.git') continue;
        const relativePath = path.posix.join(relativeDir, entry.name);
        // eslint-disable-next-line no-await-in-loop
        if (entry.isDirectory()) files.push(...await listDocumentationFiles(root, relativePath));
        else if (entry.isFile()) files.push(relativePath);
    }
    return files;
}

export async function copyCyaronDocsToSession(
    client: GoJudgeSessionClient, sessionId: string, options: CopyCyaronDocsOptions = {},
) {
    const sourceDir = options.sourceDir || findFileSync('hydrooj/docs/cyaron');
    const files = await listDocumentationFiles(sourceDir);
    for (const relativePath of files) {
        options.signal?.throwIfAborted();
        // Keep uploads sequential so documentation does not contend with session preparation requests.
        // eslint-disable-next-line no-await-in-loop
        const content = await fs.promises.readFile(path.join(sourceDir, relativePath));
        // eslint-disable-next-line no-await-in-loop
        await client.writeFile(sessionId, `docs/cyaron/${relativePath}`, content, options.signal);
    }
}
