import { randomUUID } from 'crypto';
import type { AiModelRuntimeConfig } from '../runtime';

export type HtmlToMarkdownJobResult = { jobId: string } & (
    { status: 'pending' | 'running' }
    | { status: 'completed', markdown: string }
    | { status: 'failed', error: string }
);

interface JobOwner {
    domainId: string;
    pid: number;
    uid: number;
}

interface Job extends JobOwner {
    result: HtmlToMarkdownJobResult;
    expiresAt?: number;
    timer?: ReturnType<typeof setTimeout>;
    controller?: AbortController;
}

interface HtmlToMarkdownJobsOptions {
    capacity?: number;
    capacityPerOwner?: number;
    retentionMs?: number;
    timeoutMs?: number;
}

export class HtmlToMarkdownJobs {
    private jobs = new Map<string, Job>();
    private options: Required<HtmlToMarkdownJobsOptions>;

    constructor(
        private convert: (config: AiModelRuntimeConfig, html: string, signal: AbortSignal) => Promise<string>,
        options: HtmlToMarkdownJobsOptions = {},
    ) {
        this.options = {
            capacity: 100,
            capacityPerOwner: 10,
            retentionMs: 3600_000,
            timeoutMs: 900_000,
            ...options,
        };
    }

    private countOwnerJobs(owner: JobOwner) {
        let count = 0;
        for (const job of this.jobs.values()) {
            if (job.domainId === owner.domainId && job.pid === owner.pid && job.uid === owner.uid) count++;
        }
        return count;
    }

    submit(owner: JobOwner, config: AiModelRuntimeConfig, html: string): HtmlToMarkdownJobResult | null {
        this.cleanup();
        if (this.jobs.size >= this.options.capacity || this.countOwnerJobs(owner) >= this.options.capacityPerOwner) return null;
        const jobId = randomUUID();
        const result: HtmlToMarkdownJobResult = { jobId, status: 'pending' };
        const job: Job = { ...owner, result };
        this.jobs.set(jobId, job);
        const snapshot = { ...config };
        setImmediate(() => {
            if (this.jobs.get(jobId) !== job) return;
            job.result = { jobId, status: 'running' };
            job.controller = new AbortController();
            job.timer = setTimeout(() => {
                job.controller?.abort();
                this.finish(job, { jobId, status: 'failed', error: 'HTML-to-Markdown conversion timed out.' });
            }, this.options.timeoutMs);
            job.timer.unref();
            Promise.resolve().then(() => this.convert(snapshot, html, job.controller.signal)).then(
                (markdown) => this.finish(job, { jobId, status: 'completed', markdown }),
                () => this.finish(job, { jobId, status: 'failed', error: 'HTML-to-Markdown conversion failed.' }),
            );
        });
        return { ...result };
    }

    private finish(job: Job, result: HtmlToMarkdownJobResult) {
        if (this.jobs.get(result.jobId) !== job || job.result.status !== 'running') return;
        clearTimeout(job.timer);
        job.timer = undefined;
        job.controller = undefined;
        job.result = result;
        job.expiresAt = Date.now() + this.options.retentionMs;
    }

    get(jobId: string, owner: JobOwner): HtmlToMarkdownJobResult | null {
        this.cleanup();
        const job = this.jobs.get(jobId);
        if (!job || job.domainId !== owner.domainId || job.pid !== owner.pid || job.uid !== owner.uid) return null;
        return { ...job.result };
    }

    cleanup() {
        for (const [id, job] of this.jobs) {
            if (job.expiresAt !== undefined && job.expiresAt <= Date.now()) this.jobs.delete(id);
        }
    }

    dispose() {
        for (const job of this.jobs.values()) {
            clearTimeout(job.timer);
            job.controller?.abort();
        }
        this.jobs.clear();
    }
}
