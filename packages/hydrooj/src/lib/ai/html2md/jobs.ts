import { Logger } from '../../../logger';
import {
    HTML_TO_MARKDOWN_TIMEOUT_MESSAGE,
    htmlToMarkdownJob, type HtmlToMarkdownJobModel, type HtmlToMarkdownJobOwner, type HtmlToMarkdownJobResult,
} from '../../../model/htmlToMarkdownJob';
import type { AiModelRuntimeConfig } from '../runtime';

const FAILURE_MESSAGE = 'HTML-to-Markdown conversion failed.';
const logger = new Logger('html-to-markdown');

export const HTML_TO_MARKDOWN_TIMEOUT_MS = 900_000;
export const HTML_TO_MARKDOWN_RETENTION_MS = 3_600_000;

interface HtmlToMarkdownJobsOptions {
    timeoutMs?: number;
    retentionMs?: number;
    store?: HtmlToMarkdownJobModel;
}

type ConvertFn = (config: AiModelRuntimeConfig, html: string, signal: AbortSignal) => Promise<string>;

// In-process conversion runner over a shared, cross-worker job store. Persistence, capacity, and the
// pending -> running claim live in the store; this class only executes the model call for jobs this
// process admitted and guards against double-running a job another worker already claimed.
export class HtmlToMarkdownJobs {
    private timeoutMs: number;
    private retentionMs: number;
    private store: HtmlToMarkdownJobModel;
    private controllers = new Map<string, AbortController>();
    private active = new Set<Promise<void>>();

    constructor(
        private convert: ConvertFn,
        options: HtmlToMarkdownJobsOptions = {},
    ) {
        this.timeoutMs = options.timeoutMs ?? HTML_TO_MARKDOWN_TIMEOUT_MS;
        this.retentionMs = options.retentionMs ?? HTML_TO_MARKDOWN_RETENTION_MS;
        this.store = options.store ?? htmlToMarkdownJob;
    }

    async submit(owner: HtmlToMarkdownJobOwner, config: AiModelRuntimeConfig, html: string): Promise<HtmlToMarkdownJobResult | null> {
        const persistedConfig = { ...config };
        delete persistedConfig.apiKey;
        const jobId = await this.store.submit(owner, { config: persistedConfig, html });
        if (!jobId) return null;
        const running = this.run(jobId, { ...config }, html)
            .catch((error) => { logger.error('Job %s failed:', jobId, error); })
            .finally(() => this.active.delete(running));
        this.active.add(running);
        return { jobId, status: 'pending' };
    }

    async drain() {
        while (this.active.size) {
            const pending = [...this.active];
            // eslint-disable-next-line no-await-in-loop
            await Promise.all(pending);
        }
    }

    private async run(jobId: string, config: AiModelRuntimeConfig, html: string) {
        if (!await this.store.claim(jobId)) return;
        const controller = new AbortController();
        this.controllers.set(jobId, controller);
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        timer.unref();
        try {
            const markdown = await this.convert(config, html, controller.signal);
            if (controller.signal.aborted) throw new Error(HTML_TO_MARKDOWN_TIMEOUT_MESSAGE);
            await this.store.finish(jobId, { markdown }, this.retentionMs);
        } catch {
            const error = controller.signal.aborted ? HTML_TO_MARKDOWN_TIMEOUT_MESSAGE : FAILURE_MESSAGE;
            await this.store.finish(jobId, { error }, this.retentionMs);
        } finally {
            clearTimeout(timer);
            this.controllers.delete(jobId);
        }
    }

    async get(jobId: string, owner: HtmlToMarkdownJobOwner): Promise<HtmlToMarkdownJobResult | null> {
        return this.store.view(jobId, owner, { timeoutMs: this.timeoutMs, retentionMs: this.retentionMs });
    }

    async sweep() {
        const now = new Date();
        await this.store.reclaimStalled(this.timeoutMs, this.retentionMs, now);
        await this.store.deleteExpired(now);
    }

    dispose() {
        for (const controller of this.controllers.values()) controller.abort();
        this.controllers.clear();
    }
}
