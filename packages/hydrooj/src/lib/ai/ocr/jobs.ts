import type { BackgroundTaskModel } from '../../../model/backgroundTask';
import {
    MARKDOWN_OCR_TASK_TYPE, MARKDOWN_OCR_TIMEOUT_MESSAGE,
    markdownOcrJob, type MarkdownOcrJobModel, type MarkdownOcrJobOwner, type MarkdownOcrJobResult,
} from '../../../model/markdownOcrJob';
import { BackgroundTaskService } from '../../background/runner';
import type { AiModelRuntimeConfig } from '../runtime';
import type { MarkdownOcrFile } from './converter';

const FAILURE_MESSAGE = 'Markdown OCR failed.';

export const MARKDOWN_OCR_TIMEOUT_MS = 900_000;
export const MARKDOWN_OCR_RETENTION_MS = 3_600_000;

interface MarkdownOcrJobsOptions {
    timeoutMs?: number;
    retentionMs?: number;
    store?: MarkdownOcrJobModel;
}

type ConvertFn = (
    config: AiModelRuntimeConfig, file: MarkdownOcrFile,
    onPage: (done: number, total: number) => void | Promise<void>, signal: AbortSignal,
) => Promise<{ markdown: string, pages: number }>;

// Maps the service's (jobId, type, ...) store calls onto the type-baked MarkdownOcrJobModel,
// translating the service's { result } / { error } finish value into the model's result shape.
function adaptJobStore(store: MarkdownOcrJobModel): BackgroundTaskModel {
    return {
        submit: (_type: string, owner: MarkdownOcrJobOwner, payload: any) => store.submit(owner, payload),
        claim: (jobId: string) => store.claim(jobId),
        finish: (jobId: string, _type: string, value: { result?: any, error?: string }, retentionMs: number) => store.finish(
            jobId,
            value.error !== undefined ? { error: value.error } : { markdown: value.result?.markdown, pages: value.result?.pages },
            retentionMs,
        ),
        get: (jobId: string, _type: string, owner: MarkdownOcrJobOwner) => store.get(jobId, owner),
        view: (jobId: string, _type: string, owner: MarkdownOcrJobOwner, timeoutMs: number, retentionMs: number) =>
            store.view(jobId, owner, { timeoutMs, retentionMs }),
        deleteExpired: (now: Date) => store.deleteExpired(now),
        reclaimStalled: (_type: string, timeoutMs: number, retentionMs: number, now: Date) =>
            store.reclaimStalled(timeoutMs, retentionMs, now),
    } as unknown as BackgroundTaskModel;
}

// The markdown-ocr adapter over the shared BackgroundTaskService, mirroring the html-to-markdown
// jobs wiring. Persistence, capacity, the pending -> running claim, timeout, failure reporting,
// sweeps, and draining all live in the service; this class only registers the conversion task
// definition and adapts the service's type-first store calls onto the markdown-ocr job model. The
// admitted process passes the full config (API key included) and the uploaded bytes as the run-time
// payload while a redacted, metadata-only payload is what gets persisted. Per-page PDF progress is
// written to the job doc so polls can report it.
export class MarkdownOcrJobs {
    private service: BackgroundTaskService;

    constructor(
        convert: ConvertFn,
        options: MarkdownOcrJobsOptions = {},
    ) {
        const jobStore = options.store ?? markdownOcrJob;
        this.service = new BackgroundTaskService(adaptJobStore(jobStore));
        this.service.register({
            type: MARKDOWN_OCR_TASK_TYPE,
            timeoutMs: options.timeoutMs ?? MARKDOWN_OCR_TIMEOUT_MS,
            retentionMs: options.retentionMs ?? MARKDOWN_OCR_RETENTION_MS,
            timeoutError: MARKDOWN_OCR_TIMEOUT_MESSAGE,
            failureError: FAILURE_MESSAGE,
            run: async (payload, signal, jobId) => {
                const { config, file } = payload as { config: AiModelRuntimeConfig, file: MarkdownOcrFile };
                const result = await convert(
                    config, file,
                    async (done, total) => { await jobStore.setProgress(jobId, done, total); },
                    signal,
                );
                if (signal.aborted) throw new Error(MARKDOWN_OCR_TIMEOUT_MESSAGE);
                return result;
            },
        });
    }

    get active() { return this.service.active; }
    get controllers() { return this.service.controllers; }

    submit(
        owner: MarkdownOcrJobOwner, config: AiModelRuntimeConfig, file: MarkdownOcrFile,
        meta: { filename?: string | null, size?: number } = {},
    ): Promise<MarkdownOcrJobResult | null> {
        const persistedConfig = { ...config };
        delete persistedConfig.apiKey;
        const persisted = {
            config: persistedConfig,
            file: { mediaType: file.mediaType, kind: file.kind, ...meta },
        };
        return this.service.submit(MARKDOWN_OCR_TASK_TYPE, owner, persisted, { config, file });
    }

    async drain() {
        await this.service.drain();
    }

    async get(jobId: string, owner: MarkdownOcrJobOwner): Promise<MarkdownOcrJobResult | null> {
        return this.service.get(MARKDOWN_OCR_TASK_TYPE, jobId, owner);
    }

    async sweep() {
        await this.service.sweep();
    }

    dispose() {
        this.service.dispose();
    }
}
