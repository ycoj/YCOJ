import type { BackgroundTaskModel } from '../../../model/backgroundTask';
import {
    HTML_TO_MARKDOWN_TASK_TYPE, HTML_TO_MARKDOWN_TIMEOUT_MESSAGE,
    htmlToMarkdownJob, type HtmlToMarkdownJobModel, type HtmlToMarkdownJobOwner, type HtmlToMarkdownJobResult,
} from '../../../model/htmlToMarkdownJob';
import { BackgroundTaskService } from '../../background/runner';
import type { AiModelRuntimeConfig } from '../runtime';

const FAILURE_MESSAGE = 'HTML-to-Markdown conversion failed.';

export const HTML_TO_MARKDOWN_TIMEOUT_MS = 900_000;
export const HTML_TO_MARKDOWN_RETENTION_MS = 3_600_000;

interface HtmlToMarkdownJobsOptions {
    timeoutMs?: number;
    retentionMs?: number;
    store?: HtmlToMarkdownJobModel;
}

type ConvertFn = (config: AiModelRuntimeConfig, html: string, signal: AbortSignal) => Promise<string>;

// Maps the service's (jobId, type, ...) store calls onto the type-baked HtmlToMarkdownJobModel,
// translating the service's { result } / { error } finish value into the model's result shape.
function adaptJobStore(store: HtmlToMarkdownJobModel): BackgroundTaskModel {
    return {
        submit: (_type: string, owner: HtmlToMarkdownJobOwner, payload: any) => store.submit(owner, payload),
        claim: (jobId: string) => store.claim(jobId),
        finish: (jobId: string, _type: string, value: { result?: any, error?: string }, retentionMs: number) => store.finish(
            jobId,
            value.error !== undefined ? { error: value.error } : { markdown: value.result?.markdown },
            retentionMs,
        ),
        get: (jobId: string, _type: string, owner: HtmlToMarkdownJobOwner) => store.get(jobId, owner),
        view: (jobId: string, _type: string, owner: HtmlToMarkdownJobOwner, timeoutMs: number, retentionMs: number) =>
            store.view(jobId, owner, { timeoutMs, retentionMs }),
        deleteExpired: (now: Date) => store.deleteExpired(now),
        reclaimStalled: (_type: string, timeoutMs: number, retentionMs: number, now: Date) =>
            store.reclaimStalled(timeoutMs, retentionMs, now),
    } as unknown as BackgroundTaskModel;
}

// The html-to-markdown adapter over the shared BackgroundTaskService. Persistence, capacity, the
// pending -> running claim, timeout, failure reporting, sweeps, and draining all live in the
// service; this class only registers the conversion task definition and adapts the service's
// type-first store calls onto the html-to-markdown job model. The admitted process passes the full
// config (API key included) as the run-time payload while a redacted payload is what gets persisted.
export class HtmlToMarkdownJobs {
    private service: BackgroundTaskService;

    constructor(
        convert: ConvertFn,
        options: HtmlToMarkdownJobsOptions = {},
    ) {
        this.service = new BackgroundTaskService(adaptJobStore(options.store ?? htmlToMarkdownJob));
        this.service.register({
            type: HTML_TO_MARKDOWN_TASK_TYPE,
            timeoutMs: options.timeoutMs ?? HTML_TO_MARKDOWN_TIMEOUT_MS,
            retentionMs: options.retentionMs ?? HTML_TO_MARKDOWN_RETENTION_MS,
            timeoutError: HTML_TO_MARKDOWN_TIMEOUT_MESSAGE,
            failureError: FAILURE_MESSAGE,
            run: async (payload, signal) => {
                const { config, html } = payload as { config: AiModelRuntimeConfig, html: string };
                const markdown = await convert(config, html, signal);
                if (signal.aborted) throw new Error(HTML_TO_MARKDOWN_TIMEOUT_MESSAGE);
                return { markdown };
            },
        });
    }

    get active() { return this.service.active; }
    get controllers() { return this.service.controllers; }

    submit(owner: HtmlToMarkdownJobOwner, config: AiModelRuntimeConfig, html: string): Promise<HtmlToMarkdownJobResult | null> {
        const persistedConfig = { ...config };
        delete persistedConfig.apiKey;
        return this.service.submit(HTML_TO_MARKDOWN_TASK_TYPE, owner, { config: persistedConfig, html }, { config, html });
    }

    async drain() {
        await this.service.drain();
    }

    async get(jobId: string, owner: HtmlToMarkdownJobOwner): Promise<HtmlToMarkdownJobResult | null> {
        return this.service.get(HTML_TO_MARKDOWN_TASK_TYPE, jobId, owner);
    }

    async sweep() {
        await this.service.sweep();
    }

    dispose() {
        this.service.dispose();
    }
}
