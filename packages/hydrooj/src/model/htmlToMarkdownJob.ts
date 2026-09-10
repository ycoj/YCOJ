import { Collection } from 'mongodb';
import {
    BACKGROUND_TASK_INDEXES, BACKGROUND_TASK_TIMEOUT_MESSAGE, type BackgroundTaskDoc,
    BackgroundTaskModel, backgroundTaskModel, type BackgroundTaskOwner, ensureBackgroundTaskIndexes,
} from './backgroundTask';
export type HtmlToMarkdownJobStatus = BackgroundTaskDoc['status'];
export type HtmlToMarkdownJobOwner = BackgroundTaskOwner;
export type HtmlToMarkdownJobDoc = BackgroundTaskDoc;
export type HtmlToMarkdownJobResult = { jobId: string } & ({ status: 'pending'|'running' } | { status: 'completed', markdown: string } | { status: 'failed', error: string });
export type HtmlToMarkdownJobView = HtmlToMarkdownJobResult;
export const HTML_TO_MARKDOWN_CAPACITY = 100;
export const HTML_TO_MARKDOWN_CAPACITY_PER_OWNER = 10;
export const HTML_TO_MARKDOWN_TIMEOUT_MESSAGE = 'HTML-to-Markdown conversion timed out.';
export const HTML_TO_MARKDOWN_TASK_TYPE = 'html-to-markdown';
const TYPE = HTML_TO_MARKDOWN_TASK_TYPE;
function asView(d: BackgroundTaskDoc): HtmlToMarkdownJobResult { if (d.status === 'completed') return { jobId: d.jobId, status: 'completed', markdown: d.result?.markdown ?? '' }; if (d.status === 'failed') return { jobId: d.jobId, status: 'failed', error: d.error ?? '' }; return { jobId: d.jobId, status: d.status }; }
export class HtmlToMarkdownJobModel {
    constructor(public coll: Collection<BackgroundTaskDoc> = backgroundTaskModel.coll, public capacity = HTML_TO_MARKDOWN_CAPACITY, public capacityPerOwner = HTML_TO_MARKDOWN_CAPACITY_PER_OWNER) {}
    submit(owner: HtmlToMarkdownJobOwner, payload?: any, now?: Date) { return this.base().submit(TYPE, owner, payload, now); }
    claim(id: string, now?: Date) { return this.base().claim(id, TYPE, now); }
    finish(id: string, result: { markdown?: string, error?: string }, retention: number, now?: Date) { return this.base().finish(id, TYPE, { result: result.markdown !== undefined ? { markdown: result.markdown } : undefined, error: result.error }, retention, now); }
    markFailed(id: string, error: string, retention: number, now?: Date) { return this.coll.updateOne({ jobId: id, type: TYPE, status: { $in: ['pending', 'running'] } }, { $set: { status: 'failed', error, finishedAt: now ?? new Date(), expiresAt: new Date((now ?? new Date()).getTime() + retention) }, $unset: { result: '' } }); }
    get(id: string, owner: HtmlToMarkdownJobOwner) { return this.base().get(id, TYPE, owner); }
    count(now = new Date()) { return this.coll.countDocuments({ type: TYPE, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] }); }
    async view(id: string, owner: HtmlToMarkdownJobOwner, o: { timeoutMs: number, retentionMs: number, now?: Date }) { const d = await this.base().view(id, TYPE, owner, o.timeoutMs, o.retentionMs); if (d?.error === BACKGROUND_TASK_TIMEOUT_MESSAGE) d.error = HTML_TO_MARKDOWN_TIMEOUT_MESSAGE; return d ? asView(d) : null; }
    deleteExpired(now?: Date) { return this.base().deleteExpired(now); }
    reclaimStalled(timeout: number, retention: number, now?: Date) { return this.base().reclaimStalled(TYPE, timeout, retention, now); }
    private base() { return new BackgroundTaskModel(this.coll, this.capacity, this.capacityPerOwner); }
}
export const htmlToMarkdownJob = new HtmlToMarkdownJobModel();
export const ensureJobIndexes = ensureBackgroundTaskIndexes;
export async function apply(ctx: any) { await ctx.db.ensureIndexes(htmlToMarkdownJob.coll, ...BACKGROUND_TASK_INDEXES); }
global.Hydro.model.htmlToMarkdownJob = htmlToMarkdownJob;
