import { Collection } from 'mongodb';
import {
    BACKGROUND_TASK_INDEXES, BACKGROUND_TASK_TIMEOUT_MESSAGE, type BackgroundTaskDoc,
    BackgroundTaskModel, backgroundTaskModel, type BackgroundTaskOwner, ensureBackgroundTaskIndexes,
} from './backgroundTask';
export type MarkdownOcrJobStatus = BackgroundTaskDoc['status'];
export type MarkdownOcrJobOwner = BackgroundTaskOwner;
export type MarkdownOcrJobDoc = BackgroundTaskDoc;
export interface MarkdownOcrJobProgress { done: number, total: number }
export type MarkdownOcrJobResult = { jobId: string } & ({ status: 'pending' | 'running', progress?: MarkdownOcrJobProgress } | { status: 'completed', markdown: string, pages: number } | { status: 'failed', error: string });
export type MarkdownOcrJobView = MarkdownOcrJobResult;
export const MARKDOWN_OCR_CAPACITY = 100;
export const MARKDOWN_OCR_CAPACITY_PER_OWNER = 10;
export const MARKDOWN_OCR_TIMEOUT_MESSAGE = 'Markdown OCR timed out.';
export const MARKDOWN_OCR_TASK_TYPE = 'markdown-ocr';
const TYPE = MARKDOWN_OCR_TASK_TYPE;
function asView(d: BackgroundTaskDoc): MarkdownOcrJobResult {
    if (d.status === 'completed') return { jobId: d.jobId, status: 'completed', markdown: d.result?.markdown ?? '', pages: d.result?.pages ?? 1 };
    if (d.status === 'failed') return { jobId: d.jobId, status: 'failed', error: d.error ?? '' };
    return { jobId: d.jobId, status: d.status, ...(d.progress ? { progress: d.progress } : {}) };
}
export class MarkdownOcrJobModel {
    constructor(public coll: Collection<BackgroundTaskDoc> = backgroundTaskModel.coll, public capacity = MARKDOWN_OCR_CAPACITY, public capacityPerOwner = MARKDOWN_OCR_CAPACITY_PER_OWNER) {}
    submit(owner: MarkdownOcrJobOwner, payload?: any, now?: Date) { return this.base().submit(TYPE, owner, payload, now); }
    claim(id: string, now?: Date) { return this.base().claim(id, TYPE, now); }
    finish(id: string, result: { markdown?: string, pages?: number, error?: string }, retention: number, now?: Date) { return this.base().finish(id, TYPE, { result: result.markdown !== undefined ? { markdown: result.markdown, pages: result.pages ?? 1 } : undefined, error: result.error }, retention, now); }
    markFailed(id: string, error: string, retention: number, now?: Date) { return this.coll.updateOne({ jobId: id, type: TYPE, status: { $in: ['pending', 'running'] } }, { $set: { status: 'failed', error, finishedAt: now ?? new Date(), expiresAt: new Date((now ?? new Date()).getTime() + retention) }, $unset: { ownerSlot: '', globalSlot: '', result: '', progress: '' } }); }
    setProgress(id: string, done: number, total: number) { return this.coll.updateOne({ jobId: id, type: TYPE, status: 'running' }, { $set: { progress: { done, total } } }); }
    get(id: string, owner: MarkdownOcrJobOwner) { return this.base().get(id, TYPE, owner); }
    count(now = new Date()) { return this.coll.countDocuments({ type: TYPE, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] }); }
    async view(id: string, owner: MarkdownOcrJobOwner, o: { timeoutMs: number, retentionMs: number, now?: Date }) {
        const d = await this.base().view(id, TYPE, owner, o.timeoutMs, o.retentionMs);
        if (d?.error === BACKGROUND_TASK_TIMEOUT_MESSAGE) d.error = MARKDOWN_OCR_TIMEOUT_MESSAGE;
        return d ? asView(d) : null;
    }

    deleteExpired(now?: Date) { return this.base().deleteExpired(now); }
    reclaimStalled(timeout: number, retention: number, now?: Date) { return this.base().reclaimStalled(TYPE, timeout, retention, now); }
    private base() { return new BackgroundTaskModel(this.coll, this.capacity, this.capacityPerOwner); }
}
export const markdownOcrJob = new MarkdownOcrJobModel();
export const ensureJobIndexes = ensureBackgroundTaskIndexes;
export async function apply(ctx: any) { await ctx.db.ensureIndexes(markdownOcrJob.coll, ...BACKGROUND_TASK_INDEXES); }
global.Hydro.model.markdownOcrJob = markdownOcrJob;
