import * as yaml from 'js-yaml';
import { ObjectId } from 'mongodb';
import { Context } from '../context';
import { RecordDoc, Task } from '../interface';
import {
    AiAgentConfig, AiAgentRunner, createAiAgent,
} from '../lib/aiGeneration/agent';
import {
    ArtifactValidationError, collectOutputArtifacts, replaceTestdataWithRollback,
} from '../lib/aiGeneration/artifacts';
import { copyCyaronDocsToSession } from '../lib/aiGeneration/documentation';
import {
    ACTIVE_AI_GENERATION_FILTER, classifyAiGenerationFailure, shouldCleanupAiGeneration,
} from '../lib/aiGeneration/policy';
import {
    AI_TESTDATA_SYSTEM_PROMPT, buildInitialPrompt, buildRepairPrompt,
} from '../lib/aiGeneration/prompt';
import { GoJudgeSessionClient, SessionError } from '../lib/aiGeneration/session';
import { Logger } from '../logger';
import { STATUS } from '../model/builtin';
import problem from '../model/problem';
import record from '../model/record';
import storage from '../model/storage';
import system from '../model/system';
import task from '../model/task';

const logger = new Logger('ai-generation');
const TOTAL_TIMEOUT_MS = 30 * 60 * 1000;
const activeRuns = new Map<string, { abort: (reason: 'cancelled' | 'timeout') => void }>();

export interface AiGenerationRuntimeConfig extends AiAgentConfig {
    enabled: boolean;
    concurrency: number;
    sandboxHost: string;
    sandboxToken?: string;
}

export function getAiGenerationConfig(): AiGenerationRuntimeConfig {
    return {
        enabled: !!system.get('aiGeneration.enabled'),
        apiType: system.get('aiGeneration.apiType') || 'openai-completions',
        baseUrl: system.get('aiGeneration.baseUrl') || '',
        model: system.get('aiGeneration.model') || '',
        apiKey: process.env.AI_GENERATION_API_KEY || system.get('aiGeneration.apiKey') || '',
        reasoning: system.get('aiGeneration.reasoning') !== false,
        thinkingLevel: system.get('aiGeneration.thinkingLevel') || 'high',
        contextTokens: +system.get('aiGeneration.contextTokens') || 128_000,
        maxTokens: +system.get('aiGeneration.maxTokens') || 32_000,
        concurrency: Math.min(32, Math.max(1, Math.trunc(+system.get('aiGeneration.concurrency') || 1))),
        sandboxHost: system.get('aiGeneration.sandboxHost') || 'http://localhost:5050',
        sandboxToken: system.get('aiGeneration.sandboxToken') || '',
    };
}

export function validateAiGenerationConfig(config: AiGenerationRuntimeConfig) {
    if (!config.enabled) throw new Error('AI test-data generation is disabled.');
    if (!['openai-completions', 'openai-responses'].includes(config.apiType)) throw new Error('Invalid AI API type.');
    if (!/^https?:\/\//.test(config.baseUrl)) throw new Error('Invalid AI API base URL.');
    if (!config.model.trim()) throw new Error('AI model is not configured.');
    if (!config.apiKey) throw new Error('AI API key is not configured.');
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(config.thinkingLevel)) {
        throw new Error('Invalid AI thinking level.');
    }
    if (!Number.isSafeInteger(config.contextTokens) || config.contextTokens < 8192 || config.contextTokens > 2_000_000) {
        throw new Error('Invalid AI context token limit.');
    }
    if (!Number.isSafeInteger(config.maxTokens)
        || config.maxTokens < 1024 || config.maxTokens > 1_000_000 || config.maxTokens > config.contextTokens) {
        throw new Error('Invalid AI maximum token limit.');
    }
    if (!/^https?:\/\//.test(config.sandboxHost)) throw new Error('Invalid go-judge Session API host.');
}

async function updateRecord(
    ctx: Context, domainId: string, rid: ObjectId,
    $set: Record<string, any> = {}, judgeText?: string,
) {
    const latest = await record.update(
        domainId, rid, $set as any,
        judgeText ? { judgeTexts: judgeText } as any : undefined,
    );
    if (latest) ctx.broadcast('record/change', latest);
    return latest;
}

async function finishRecord(
    ctx: Context, domainId: string, rid: ObjectId, status: STATUS,
    stage: NonNullable<RecordDoc['aiGeneration']>['stage'], report: string,
) {
    const current = await record.get(domainId, rid);
    const cancelled = current?.status === STATUS.STATUS_CANCELED;
    return await updateRecord(ctx, domainId, rid, {
        ...cancelled ? {} : { status },
        score: !cancelled && status === STATUS.STATUS_ACCEPTED ? 100 : 0,
        progress: !cancelled && status === STATUS.STATUS_ACCEPTED ? 100 : 0,
        judgeAt: new Date(),
        judger: 1,
        'aiGeneration.active': false,
        'aiGeneration.stage': cancelled ? 'cancelled' : stage,
        'aiGeneration.finishedAt': new Date(),
    }, report.slice(0, 20_000));
}

function createTestdataRepository(domainId: string, pid: number, uid: number) {
    const prefix = `problem/${domainId}/${pid}/testdata/`;
    const list = async () => {
        const pdoc = await problem.get(domainId, pid, ['data']);
        return (pdoc?.data || []).map((file) => file.name);
    };
    return {
        list,
        async backup(names: string[], signal?: AbortSignal) {
            const backupPrefix = `${prefix}.ai-generation-backup-${new ObjectId().toHexString()}/`;
            const copied: string[] = [];
            try {
                for (const name of names) {
                    signal?.throwIfAborted();
                    // eslint-disable-next-line no-await-in-loop
                    await storage.copy(`${prefix}${name}`, `${backupPrefix}${name}`);
                    copied.push(name);
                }
            } catch (err) {
                if (copied.length) await storage.del(copied.map((name) => `${backupPrefix}${name}`));
                throw err;
            }
            return { names, prefix: backupPrefix };
        },
        async restore(backup: { names: string[], prefix: string }) {
            const currentNames = await list();
            if (currentNames.length) await problem.delTestdata(domainId, pid, currentNames, uid);
            for (const name of backup.names) {
                // eslint-disable-next-line no-await-in-loop
                await problem.addTestdata(domainId, pid, name, await storage.get(`${backup.prefix}${name}`), uid);
            }
        },
        async discard(backup: { names: string[], prefix: string }) {
            if (backup.names.length) await storage.del(backup.names.map((name) => `${backup.prefix}${name}`));
        },
        async put(name: string, content: Buffer) {
            await problem.addTestdata(domainId, pid, name, content, uid);
        },
        async delete(names: string[]) {
            if (names.length) await problem.delTestdata(domainId, pid, names, uid);
        },
    };
}

export async function runAiGenerationTask(ctx: Context, t: Task) {
    const rid = t.rid instanceof ObjectId ? t.rid : new ObjectId(t.rid);
    const ridString = rid.toHexString();
    const rdoc = await record.get(t.domainId, rid);
    if (!rdoc || rdoc.status === STATUS.STATUS_CANCELED || !rdoc.aiGeneration?.active) return;

    let config: AiGenerationRuntimeConfig;
    try {
        config = getAiGenerationConfig();
        validateAiGenerationConfig(config);
    } catch (err) {
        await finishRecord(ctx, t.domainId, rid, STATUS.STATUS_SYSTEM_ERROR, 'failed', `Configuration error: ${err.message}`);
        return;
    }

    const client = new GoJudgeSessionClient({
        baseUrl: config.sandboxHost,
        token: config.sandboxToken,
        requestTimeoutMs: 130_000,
    });
    const controller = new AbortController();
    let agent: AiAgentRunner;
    let sessionId: string;
    let termination: 'cancelled' | 'timeout';
    let report = '';
    const abort = (reason: 'cancelled' | 'timeout') => {
        termination ||= reason;
        controller.abort(reason);
        agent?.abort();
    };
    activeRuns.set(ridString, { abort });
    const timeout = setTimeout(() => abort('timeout'), TOTAL_TIMEOUT_MS);

    try {
        await updateRecord(ctx, t.domainId, rid, {
            status: STATUS.STATUS_JUDGING,
            progress: 1,
            'aiGeneration.stage': 'preparing',
            'aiGeneration.startedAt': new Date(),
        }, `Starting AI generation with ${config.model}.`);
        const pdoc = await problem.get(
            t.domainId, t.pid,
            ['title', 'content', 'config', 'data', 'additional_file', 'reference'], true,
        );
        if (!pdoc) throw new Error('Problem no longer exists.');
        if (pdoc.reference) throw new Error('Cannot generate data for a referenced problem.');

        ({ sessionId } = await client.create(controller.signal));
        await updateRecord(ctx, t.domainId, rid, {
            progress: 5,
            'aiGeneration.sessionId': sessionId,
        });
        const rawConfig = typeof pdoc.config === 'string' ? pdoc.config : yaml.dump(pdoc.config || {});
        await client.writeFile(sessionId, 'problem.md', `# ${pdoc.title}\n\n${pdoc.content || ''}\n`, controller.signal);
        await client.writeFile(sessionId, 'problem-config.yaml', rawConfig || '{}\n', controller.signal);
        await copyCyaronDocsToSession(client, sessionId, { signal: controller.signal });
        await client.execShell(sessionId, 'mkdir -p output', controller.signal);

        await updateRecord(ctx, t.domainId, rid, {
            progress: 10,
            'aiGeneration.stage': 'agent',
        });
        agent = await createAiAgent(
            config, client, sessionId, `ai-generation-${ridString}`, AI_TESTDATA_SYSTEM_PROMPT,
            async (event) => {
                const action = event.phase === 'tool-start' ? 'calling' : event.failed ? 'failed' : 'completed';
                await updateRecord(ctx, t.domainId, rid, {}, `[${event.tool}] ${action}${event.summary ? `: ${event.summary}` : ''}`);
            },
        );

        let artifacts;
        for (let attempt = 0; attempt <= 3; attempt++) {
            // eslint-disable-next-line no-await-in-loop
            report = await agent.prompt(attempt
                ? buildRepairPrompt((artifacts as any)?.error, attempt)
                : buildInitialPrompt(t.instructions));
            // eslint-disable-next-line no-await-in-loop
            await updateRecord(ctx, t.domainId, rid, {
                progress: 70 + attempt * 5,
                'aiGeneration.stage': 'validating',
            });
            try {
                const maxFiles = Math.max(
                    0,
                    (system.get('limit.problem_files_max') || 100) - (pdoc.additional_file?.length || 0) - 1,
                );
                const additionalBytes = (pdoc.additional_file || []).reduce((sum, file) => sum + (file.size || 0), 0);
                const maxBytes = Math.max(
                    0,
                    (system.get('limit.problem_files_max_size') || 256 * 1024 * 1024) - additionalBytes - 1,
                );
                // eslint-disable-next-line no-await-in-loop
                artifacts = await collectOutputArtifacts(client, sessionId, { maxFiles, maxBytes }, controller.signal);
                break;
            } catch (err) {
                if (!(err instanceof ArtifactValidationError) || attempt === 3) throw err;
                artifacts = { error: err.message } as any;
                // eslint-disable-next-line no-await-in-loop
                await updateRecord(ctx, t.domainId, rid, {}, `Artifact validation failed; requesting repair ${attempt + 1}/3: ${err.message}`);
            }
        }
        if (!artifacts?.files) throw new ArtifactValidationError('Agent did not produce valid artifacts.');
        await updateRecord(ctx, t.domainId, rid, {
            progress: 95,
            'aiGeneration.stage': 'replacing',
        });
        const latest = await record.get(t.domainId, rid);
        if (latest?.status === STATUS.STATUS_CANCELED) throw new SessionError('cancelled', 'Generation was cancelled.');
        await replaceTestdataWithRollback(
            createTestdataRepository(t.domainId, t.pid, t.uid), artifacts.files, controller.signal,
        );
        await finishRecord(
            ctx, t.domainId, rid, STATUS.STATUS_ACCEPTED, 'completed',
            `${report || 'AI generation completed.'}\n\nInstalled ${artifacts.caseCount} test case(s), ${artifacts.totalBytes} bytes.`,
        );
    } catch (err) {
        const failure = classifyAiGenerationFailure(
            termination,
            err instanceof SessionError && ['cancelled', 'timeout'].includes(err.kind) ? err.kind as 'cancelled' | 'timeout' : undefined,
            err instanceof ArtifactValidationError,
        );
        const status = failure === 'cancelled' ? STATUS.STATUS_CANCELED
            : failure === 'timeout' ? STATUS.STATUS_TIME_LIMIT_EXCEEDED
                : failure === 'format' ? STATUS.STATUS_FORMAT_ERROR : STATUS.STATUS_SYSTEM_ERROR;
        const label = failure === 'cancelled' ? 'AI generation cancelled.'
            : failure === 'timeout' ? 'AI generation exceeded the 30-minute limit.'
                : `AI generation failed: ${err instanceof Error ? err.message : String(err)}`;
        await finishRecord(
            ctx, t.domainId, rid, status, failure === 'cancelled' ? 'cancelled' : 'failed',
            report ? `${label}\n\nLast agent report:\n${report}` : label,
        );
    } finally {
        clearTimeout(timeout);
        activeRuns.delete(ridString);
        if (sessionId) {
            try {
                await client.destroy(sessionId);
            } catch (err) {
                logger.error('Failed to destroy AI generation session %s: %O', sessionId, err);
            }
        }
    }
}

export async function cleanupStaleAiGeneration(ctx: Context, client?: GoJudgeSessionClient) {
    const active = await record.coll.find(ACTIVE_AI_GENERATION_FILTER).toArray() as RecordDoc[];
    for (const rdoc of active) {
        const hasQueuedTask = rdoc.aiGeneration?.stage === 'waiting'
            // eslint-disable-next-line no-await-in-loop
            ? await task.count({ type: 'ai-generate', rid: rdoc._id }) > 0
            : false;
        if (!shouldCleanupAiGeneration(rdoc.aiGeneration?.stage, hasQueuedTask)) continue;
        if (client && rdoc.aiGeneration?.sessionId) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await client.destroy(rdoc.aiGeneration.sessionId);
            } catch (err) {
                logger.warn('Unable to clean stale session %s: %O', rdoc.aiGeneration.sessionId, err);
            }
        }
        // eslint-disable-next-line no-await-in-loop
        await finishRecord(
            ctx, rdoc.domainId, rdoc._id, STATUS.STATUS_SYSTEM_ERROR, 'failed',
            'AI generation could not be resumed after worker restart.',
        );
    }
}

export async function apply(ctx: Context) {
    if (process.env.NODE_APP_INSTANCE !== '0') return;
    try {
        await record.coll.createIndex(
            { domainId: 1, pid: 1 },
            {
                name: 'ai_generation_active_problem',
                unique: true,
                partialFilterExpression: { lang: 'ai', 'aiGeneration.active': true },
            },
        );
    } catch (err) {
        logger.error('Failed to create AI generation active-record index: %O', err);
    }
    const initialConfig = getAiGenerationConfig();
    let cleanupClient: GoJudgeSessionClient;
    try {
        cleanupClient = new GoJudgeSessionClient({
            baseUrl: initialConfig.sandboxHost,
            token: initialConfig.sandboxToken,
        });
    } catch (err) {
        logger.error('Invalid go-judge Session configuration during startup cleanup: %O', err);
    }
    await cleanupStaleAiGeneration(ctx, cleanupClient);
    const consumer = task.consume({ type: 'ai-generate' }, (t) => runAiGenerationTask(ctx, t), false, initialConfig.concurrency);
    const disposeSetting = ctx.on('system/setting', () => {
        consumer.setConcurrency(getAiGenerationConfig().concurrency);
    });
    const disposeRecord = ctx.on('record/change', (rdoc: RecordDoc) => {
        if (rdoc?.status === STATUS.STATUS_CANCELED) activeRuns.get(rdoc._id.toHexString())?.abort('cancelled');
    });
    ctx.effect(() => () => {
        consumer.destroy();
        disposeSetting();
        disposeRecord();
        for (const run of activeRuns.values()) run.abort('cancelled');
    });
}
