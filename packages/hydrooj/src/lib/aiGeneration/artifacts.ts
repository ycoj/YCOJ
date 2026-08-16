import * as yaml from 'js-yaml';
import { parseConfig } from '../testdataConfig';
import { GoJudgeSessionClient, validateSessionPath } from './session';

export class ArtifactValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ArtifactValidationError';
    }
}

export interface GeneratedArtifacts {
    files: Map<string, Buffer>;
    totalBytes: number;
    caseCount: number;
}

function referencedCases(config: any) {
    const result: { input?: string, output?: string }[] = [];
    if (Array.isArray(config?.cases)) result.push(...config.cases);
    if (Array.isArray(config?.subtasks)) {
        for (const subtask of config.subtasks) if (Array.isArray(subtask?.cases)) result.push(...subtask.cases);
    }
    return result;
}

export async function collectOutputArtifacts(
    client: GoJudgeSessionClient, sessionId: string,
    limits: { maxFiles: number, maxBytes: number }, signal?: AbortSignal,
): Promise<GeneratedArtifacts> {
    const listed = (await client.listFiles(sessionId, signal)).filter((file) => file.name.startsWith('output/'));
    if (!listed.length) throw new ArtifactValidationError('output/ is empty.');
    if (listed.length > limits.maxFiles) throw new ArtifactValidationError(`output/ contains too many files (${listed.length}/${limits.maxFiles}).`);
    if (listed.some((file) => !Number.isSafeInteger(file.size) || file.size < 0)) {
        throw new ArtifactValidationError('output/ contains invalid file metadata.');
    }
    const totalBytes = listed.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > limits.maxBytes) throw new ArtifactValidationError(`output/ is too large (${totalBytes}/${limits.maxBytes} bytes).`);

    const files = new Map<string, Buffer>();
    for (const file of listed) {
        const relative = file.name.slice('output/'.length);
        try {
            validateSessionPath(relative);
        } catch {
            throw new ArtifactValidationError(`Invalid output path: ${file.name}`);
        }
        if (relative.includes('/')) throw new ArtifactValidationError(`Nested output files are not supported: ${relative}`);
        if (!/\.(?:in|out)$/.test(relative) && relative !== 'config.yaml') {
            throw new ArtifactValidationError(`Unexpected output artifact: ${relative}`);
        }
        // eslint-disable-next-line no-await-in-loop
        files.set(relative, await client.readFile(sessionId, file.name, signal, limits.maxBytes));
    }

    if (!files.has('config.yaml')) throw new ArtifactValidationError('output/ must contain exactly one config.yaml.');
    const inputs = [...files.keys()].filter((name) => name.endsWith('.in'));
    const outputs = [...files.keys()].filter((name) => name.endsWith('.out'));
    if (!inputs.length) throw new ArtifactValidationError('output/ must contain at least one .in/.out pair.');
    const inputBases = new Set(inputs.map((name) => name.slice(0, -3)));
    const outputBases = new Set(outputs.map((name) => name.slice(0, -4)));
    const missingOutputs = [...inputBases].filter((name) => !outputBases.has(name));
    const missingInputs = [...outputBases].filter((name) => !inputBases.has(name));
    if (missingOutputs.length || missingInputs.length) {
        throw new ArtifactValidationError(`Unpaired test data: ${[
            ...missingOutputs.map((name) => `${name}.out missing`),
            ...missingInputs.map((name) => `${name}.in missing`),
        ].join(', ')}`);
    }

    const configText = files.get('config.yaml').toString('utf8');
    let rawConfig: any;
    try {
        rawConfig = yaml.load(configText);
        if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) throw new Error('root must be an object');
        const parsed = await parseConfig(configText, [...files.keys()]);
        if (!parsed.count) throw new Error('configuration selects no test cases');
    } catch (err) {
        throw new ArtifactValidationError(`Invalid config.yaml: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const testCase of referencedCases(rawConfig)) {
        for (const key of ['input', 'output'] as const) {
            const name = testCase?.[key];
            if (!name || name === '/dev/null') continue;
            if (!files.has(name)) throw new ArtifactValidationError(`config.yaml references missing file: ${name}`);
        }
    }
    return { files, totalBytes, caseCount: inputs.length };
}

export interface TestdataRepository<Backup = unknown> {
    list(): Promise<string[]>;
    put(name: string, content: Buffer): Promise<void>;
    delete(names: string[]): Promise<void>;
    backup(names: string[], signal?: AbortSignal): Promise<Backup>;
    restore(backup: Backup): Promise<void>;
    discard(backup: Backup): Promise<void>;
}

export async function replaceTestdataWithRollback<Backup>(
    repository: TestdataRepository<Backup>, generated: Map<string, Buffer>, signal?: AbortSignal,
) {
    const existingNames = await repository.list();
    const backup = await repository.backup(existingNames, signal);
    try {
        signal?.throwIfAborted();
        for (const [name, content] of generated) {
            signal?.throwIfAborted();
            // eslint-disable-next-line no-await-in-loop
            await repository.put(name, content);
        }
        signal?.throwIfAborted();
        const obsolete = existingNames.filter((name) => !generated.has(name));
        if (obsolete.length) await repository.delete(obsolete);
        signal?.throwIfAborted();
    } catch (cause) {
        const rollbackErrors: Error[] = [];
        try {
            await repository.restore(backup);
        } catch (err) {
            rollbackErrors.push(err as Error);
        }
        try {
            await repository.discard(backup);
        } catch (err) {
            rollbackErrors.push(err as Error);
        }
        if (rollbackErrors.length) {
            throw new AggregateError([cause, ...rollbackErrors], 'Failed to replace test data and rollback completely.');
        }
        throw cause;
    }
    await repository.discard(backup);
}
