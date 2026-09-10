import { ObjectId } from 'mongodb';
import { Context } from '../context';
import {
    ContestNotAttendedError, ContestNotFoundError,
    ContestNotLiveError, HtmlToMarkdownCapacityError, NotFoundError, PermissionError, ProblemNotFoundError, ValidationError,
} from '../error';
import type { ProblemDoc, User } from '../interface';
import { convertHtmlToMarkdown, MAX_HTML_TO_MARKDOWN_LENGTH } from '../lib/ai/html2md/converter';
import { HtmlToMarkdownJobs } from '../lib/ai/html2md/jobs';
import { getHtmlToMarkdownConfig } from '../lib/ai/html2md/runtime';
import { validateHtmlToMarkdownConfig } from '../lib/ai/html2md/validation';
import { PERM } from '../model/builtin';
import * as contest from '../model/contest';
import problem from '../model/problem';
import { Handler, param, post, route, Types } from '../service/server';
import type { Projection } from '../typeutils';

// The single gate for "may this user run/read an HTML-to-Markdown job on this problem".
// Both the submit route and the poll route call this exactly once per request, so contest-context,
// hidden/visibility, and edit-permission rules live in exactly one place. `tid` must be a real
// ObjectId from a decorated param; this function loads its own contest docs (no implicit
// ctx.tdoc from another handler's prepare step).
export async function resolveEditableProblem(
    ctx: { user: User, checkPerm: (perm: bigint) => void },
    domainId: string, pid: number | string, tid?: ObjectId,
    projection: Projection<ProblemDoc> = ['docId', 'owner', 'maintainer', 'hidden'],
): Promise<ProblemDoc> {
    const pdoc = await problem.get(domainId, pid, projection);
    if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
    if (tid) {
        const [tdoc, tsdoc] = await Promise.all([
            contest.get(domainId, tid),
            contest.getStatus(domainId, tid, ctx.user._id),
        ]);
        if (!tdoc?.pids?.includes(pdoc.docId)) throw new ContestNotFoundError(domainId, tid);
        if (contest.isNotStarted(tdoc)) throw new ContestNotLiveError(tid);
        if (!contest.isDone(tdoc, tsdoc) && (!tsdoc?.attend || !tsdoc.startAt)) {
            throw new ContestNotAttendedError(tid);
        }
    } else if (!problem.canViewBy(pdoc, ctx.user)) {
        throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);
    }
    if (!ctx.user.own(pdoc, PERM.PERM_EDIT_PROBLEM_SELF)) ctx.checkPerm(PERM.PERM_EDIT_PROBLEM);
    return pdoc;
}

declare module 'cordis' {
    interface Context {
        htmlToMarkdownJobs: HtmlToMarkdownJobs;
    }
}

// The single runner instance is owned by the cordis context: apply(ctx) below creates it (or
// accepts one provided earlier on the context — the only injection seam), and the sweep, dispose,
// and both handlers all read that exact same service instance. HtmlToMarkdownJobs is a thin
// adapter that registers the conversion definition on a BackgroundTaskService.
function getJobs(handler: Handler): HtmlToMarkdownJobs {
    const jobs = handler.ctx.get('htmlToMarkdownJobs');
    if (!jobs) throw new Error('HTML-to-Markdown job runner is not registered.');
    return jobs;
}

// Admits an HTML-to-Markdown conversion of the problem's stored content into the shared job store
// and returns 202 with the pending job. The body may carry an optional profileId; contest context
// passes tid (query or body), coerced to a real ObjectId by the decorated param.
export class ProblemHtmlToMarkdownSubmitHandler extends Handler {
    @route('pid', Types.ProblemId, true)
    @param('tid', Types.ObjectId, true)
    @post('profileId', Types.String, true)
    async post(domainId: string, pid: number | string, tid?: ObjectId, profileId = '') {
        const pdoc = await resolveEditableProblem(
            this, domainId, pid, tid,
            ['docId', 'owner', 'maintainer', 'hidden', 'content'],
        );
        const config = getHtmlToMarkdownConfig(profileId);
        validateHtmlToMarkdownConfig(config);
        if (pdoc.content.length > MAX_HTML_TO_MARKDOWN_LENGTH) {
            throw new ValidationError('content', `HTML content exceeds ${MAX_HTML_TO_MARKDOWN_LENGTH} characters.`);
        }
        const result = await getJobs(this).submit({ domainId, pid: pdoc.docId, uid: this.user._id }, config, pdoc.content);
        if (!result) throw new HtmlToMarkdownCapacityError();
        this.response.status = 202;
        this.response.type = 'application/json';
        this.response.body = result;
    }
}

export class ProblemHtmlToMarkdownHandler extends Handler {
    pdoc: ProblemDoc;

    @route('pid', Types.ProblemId, true)
    @param('tid', Types.ObjectId, true)
    async _prepare(domainId: string, pid: number | string, tid?: ObjectId) {
        this.pdoc = await resolveEditableProblem(this, domainId, pid, tid);
    }

    @route('jobId', Types.String)
    async get(domainId: string, jobId: string) {
        const result = await getJobs(this).get(jobId, { domainId, pid: this.pdoc.docId, uid: this.user._id });
        if (!result) throw new NotFoundError(jobId);
        this.response.type = 'application/json';
        this.response.body = result;
    }
}

export async function apply(ctx: Context) {
    const provided = ctx.get('htmlToMarkdownJobs');
    const jobs = provided ?? new HtmlToMarkdownJobs(convertHtmlToMarkdown);
    if (!provided) ctx.provide('htmlToMarkdownJobs', jobs);
    ctx.effect(() => () => jobs.dispose());
    // Only the PM2 master (instance 0) runs the periodic stale reclaim/expiry sweep, mirroring
    // aiGeneration's single-worker cleanup; every worker still reclaims stalled jobs on poll.
    if (process.env.NODE_APP_INSTANCE === '0') {
        ctx.effect(() => {
            const timer = setInterval(() => void jobs.sweep(), 60_000);
            timer.unref();
            return () => clearInterval(timer);
        });
    }
    ctx.Route('problem_html_to_markdown_submit', '/p/:pid/html-to-markdown', ProblemHtmlToMarkdownSubmitHandler);
    ctx.Route('problem_html_to_markdown', '/p/:pid/html-to-markdown/:jobId', ProblemHtmlToMarkdownHandler);
}
