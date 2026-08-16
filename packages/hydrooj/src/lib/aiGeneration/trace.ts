import { STATUS, TestCase } from '@hydrooj/common';

export const AI_GENERATION_TRACE_SCHEMA = 'hydro.ai-generation.trace';
export const AI_GENERATION_TRACE_VERSION = 1 as const;

export type AiTraceType =
    | 'generation'
    | 'preparation'
    | 'agent_turn'
    | 'tool'
    | 'validation'
    | 'replacement';
export type AiTraceState = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export interface AiTraceMessage {
    schema: typeof AI_GENERATION_TRACE_SCHEMA;
    version: typeof AI_GENERATION_TRACE_VERSION;
    seq: number;
    type: AiTraceType;
    state: AiTraceState;
    startedAt: string;
    finishedAt?: string;
    data: Record<string, any>;
}

export interface AiTraceHandle {
    id: number;
    type: AiTraceType;
    startedAt: number;
    startedAtIso: string;
}

export interface AiTraceStore {
    append(testcase: Required<TestCase>): Promise<any>;
    update(id: number, set: Record<string, any>): Promise<any>;
}

export function serializeAiTraceMessage(message: AiTraceMessage) {
    return JSON.stringify(message);
}

export function aiTraceStatus(type: AiTraceType, state: AiTraceState, override?: STATUS) {
    if (override !== undefined) return override;
    if (state === 'running') return STATUS.STATUS_JUDGING;
    if (state === 'succeeded') return STATUS.STATUS_ACCEPTED;
    if (state === 'cancelled') return STATUS.STATUS_CANCELED;
    if (state === 'timed_out') return STATUS.STATUS_TIME_LIMIT_EXCEEDED;
    return type === 'validation' ? STATUS.STATUS_FORMAT_ERROR : STATUS.STATUS_SYSTEM_ERROR;
}

function nowIso() {
    return new Date().toISOString();
}

function elapsed(startedAt: number) {
    return Math.max(0, Date.now() - startedAt);
}

export class AiGenerationTrace {
    private sequence: number;
    private operation = Promise.resolve();

    constructor(
        private readonly store: AiTraceStore,
        initialCount = 0,
    ) {
        this.sequence = Math.max(0, initialCount);
    }

    private enqueue<T>(operation: () => Promise<T>) {
        const result = this.operation.then(operation);
        this.operation = result.then(() => undefined, () => undefined);
        return result;
    }

    async start(type: AiTraceType, data: Record<string, any> = {}): Promise<AiTraceHandle> {
        const id = ++this.sequence;
        const startedAt = Date.now();
        const startedAtIso = nowIso();
        const message: AiTraceMessage = {
            schema: AI_GENERATION_TRACE_SCHEMA,
            version: AI_GENERATION_TRACE_VERSION,
            seq: id,
            type,
            state: 'running',
            startedAt: startedAtIso,
            data,
        };
        const testcase: Required<TestCase> = {
            id,
            subtaskId: 0,
            score: 0,
            time: 0,
            memory: 0,
            status: aiTraceStatus(type, 'running'),
            message: serializeAiTraceMessage(message),
        };
        await this.enqueue(async () => {
            await this.store.append(testcase);
        });
        return { id, type, startedAt, startedAtIso };
    }

    async finish(
        handle: AiTraceHandle,
        state: Exclude<AiTraceState, 'running'>,
        data: Record<string, any> = {},
        status?: STATUS,
        extraSet: Record<string, any> = {},
    ) {
        const finishedAt = nowIso();
        const message: AiTraceMessage = {
            schema: AI_GENERATION_TRACE_SCHEMA,
            version: AI_GENERATION_TRACE_VERSION,
            seq: handle.id,
            type: handle.type,
            state,
            startedAt: handle.startedAtIso,
            finishedAt,
            data,
        };
        const updateSet = {
            ...extraSet,
            'testCases.$.status': aiTraceStatus(handle.type, state, status),
            'testCases.$.time': elapsed(handle.startedAt),
            'testCases.$.message': serializeAiTraceMessage(message),
        };
        return await this.enqueue(async () => {
            return await this.store.update(handle.id, updateSet);
        });
    }
}

export function createAiGenerationTrace(
    ctx: any, recordModel: any, domainId: string, rid: any, initialCount = 0,
) {
    return new AiGenerationTrace({
        async append(testcase) {
            const latest = await recordModel.update(
                domainId, rid, undefined, { testCases: testcase } as any,
            );
            if (latest) ctx.broadcast('record/change', latest);
            return latest;
        },
        async update(id, set) {
            const latest = await recordModel.coll.findOneAndUpdate(
                { _id: rid, domainId, 'testCases.id': id },
                { $set: set },
                { returnDocument: 'after' },
            );
            if (latest) ctx.broadcast('record/change', latest);
            return latest;
        },
    }, initialCount);
}
