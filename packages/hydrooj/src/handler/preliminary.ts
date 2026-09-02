import { escapeRegExp } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import { Context } from '../context';
import { PreliminaryAttemptNotFoundError, PreliminaryPaperNotPublishedError } from '../error';
import type { PreliminaryPaperDoc } from '../interface';
import {
    preliminaryQuestionCount, preliminaryTotalScore, toPreliminaryReview, toPublicPreliminaryDefinition,
} from '../lib/preliminary';
import { PERM, PRIV } from '../model/builtin';
import * as preliminary from '../model/preliminary';
import user from '../model/user';
import {
    Handler, param, post, Types,
} from '../service/server';

function canEdit(handler: Handler, paper: PreliminaryPaperDoc) {
    return handler.user.own(paper, PERM.PERM_EDIT_PROBLEM_SELF)
        || handler.user.hasPerm(PERM.PERM_EDIT_PROBLEM);
}

function paperSummary(paper: PreliminaryPaperDoc) {
    return {
        docId: paper.docId,
        owner: paper.owner,
        title: paper.title,
        content: paper.content,
        published: paper.published,
        revision: paper.revision,
        nAttempt: paper.nAttempt,
        updatedAt: paper.updatedAt,
        questionCount: preliminaryQuestionCount(paper),
        totalScore: preliminaryTotalScore(paper),
    };
}

function withQuestionNumbers<T extends { sections: Array<{ questions: unknown[] }> }>(definition: T) {
    let number = 0;
    return {
        ...definition,
        sections: definition.sections.map((section) => ({
            ...section,
            questions: section.questions.map((question) => ({
                ...question as object,
                questionNumber: ++number,
            })),
        })),
    };
}

async function attemptSummary(domainId: string, attempt) {
    const revision = await preliminary.getRevisionById(domainId, attempt.revisionId);
    return {
        docId: attempt.docId,
        paperId: attempt.paperId,
        revision: attempt.revision,
        title: revision?.title || '',
        score: attempt.score,
        totalScore: attempt.totalScore,
        submittedAt: attempt.submittedAt,
    };
}

class PreliminaryMainHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    @param('view', Types.Range(['papers', 'attempts']), true)
    async get(domainId: string, page = 1, q = '', view: 'papers' | 'attempts' = 'papers') {
        if (view === 'attempts' && this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            const [attempts, pcount] = await this.paginate(
                preliminary.getAttempts(domainId, { owner: this.user._id }), page, 'preliminary',
            );
            this.response.body = {
                view,
                attempts: await Promise.all(attempts.map((attempt) => attemptSummary(domainId, attempt))),
                page,
                pcount,
                q: '',
            };
        } else {
            view = 'papers';
            const query: Filter<PreliminaryPaperDoc> = {};
            if (q) query.title = { $regex: new RegExp(escapeRegExp(q), 'i') };
            if (!this.user.hasPerm(PERM.PERM_EDIT_PROBLEM)) {
                query.$or = [{ published: true }];
                if (this.user.hasPerm(PERM.PERM_EDIT_PROBLEM_SELF)) query.$or.push({ owner: this.user._id });
            }
            const [papers, pcount] = await this.paginate(
                preliminary.getMulti(domainId, query), page, 'preliminary',
            );
            this.response.body = {
                view,
                papers: papers.map(paperSummary),
                page,
                pcount,
                q,
            };
        }
        this.response.template = 'preliminary_main.html';
    }
}

class PreliminaryDetailHandler extends Handler {
    paper: PreliminaryPaperDoc;

    @param('paperId', Types.ObjectId)
    async prepare(domainId: string, paperId: ObjectId) {
        this.paper = await preliminary.get(domainId, paperId);
        if (!this.paper.published && !canEdit(this, this.paper)) {
            throw new PreliminaryPaperNotPublishedError(paperId);
        }
    }

    @param('paperId', Types.ObjectId)
    async get(domainId: string, paperId: ObjectId) {
        const definition = this.paper.published
            ? await preliminary.getRevisionById(domainId, this.paper.activeRevisionId)
            : this.paper;
        if (!definition) throw new PreliminaryPaperNotPublishedError(paperId);
        const attempts = this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
            ? await preliminary.getAttempts(domainId, { parentId: paperId, owner: this.user._id }).limit(20).toArray()
            : [];
        this.UiContext.preliminary = {
            paperId: paperId.toHexString(),
            revision: this.paper.revision,
        };
        this.UiContext.extraTitleContent = this.paper.title;
        this.response.body = {
            paper: {
                ...paperSummary(this.paper),
                ...withQuestionNumbers(toPublicPreliminaryDefinition(definition)),
            },
            attempts: await Promise.all(attempts.map((attempt) => attemptSummary(domainId, attempt))),
            owner: await user.getById(domainId, this.paper.owner),
            canEdit: canEdit(this, this.paper),
            canSubmit: this.paper.published
                && this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
                && this.user.hasPerm(PERM.PERM_SUBMIT_PROBLEM),
        };
        this.response.template = 'preliminary_detail.html';
    }

    @param('paperId', Types.ObjectId)
    @post('revision', Types.PositiveInt)
    @post('answers', Types.Any)
    async postSubmit(domainId: string, paperId: ObjectId, revision: number, answers: unknown) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        this.checkPerm(PERM.PERM_SUBMIT_PROBLEM);
        await this.limitRate('preliminary_submit', 60, 20, '{{user}}');
        const attempt = await preliminary.submit(domainId, paperId, revision, this.user._id, answers);
        this.response.body = {
            attemptId: attempt.docId,
            score: attempt.score,
            totalScore: attempt.totalScore,
        };
        this.response.redirect = this.url('preliminary_attempt', { paperId, attemptId: attempt.docId });
    }

    @param('paperId', Types.ObjectId)
    async postDelete(domainId: string, paperId: ObjectId) {
        if (!canEdit(this, this.paper)) this.checkPerm(PERM.PERM_EDIT_PROBLEM);
        await preliminary.del(domainId, paperId);
        this.response.redirect = this.url('preliminary_main');
    }
}

class PreliminaryEditHandler extends Handler {
    paper?: PreliminaryPaperDoc;

    @param('paperId', Types.ObjectId, true)
    async prepare(domainId: string, paperId?: ObjectId) {
        if (!paperId) {
            this.checkPerm(PERM.PERM_CREATE_PROBLEM);
            return;
        }
        this.paper = await preliminary.get(domainId, paperId);
        if (!canEdit(this, this.paper)) this.checkPerm(PERM.PERM_EDIT_PROBLEM);
    }

    async get() {
        const definition = this.paper ? {
            title: this.paper.title,
            content: this.paper.content,
            sections: this.paper.sections,
        } : {
            title: '',
            content: '',
            sections: [],
        };
        this.UiContext.preliminaryEditor = {
            definition,
            existing: Boolean(this.paper),
            published: Boolean(this.paper?.published),
        };
        this.response.body = {
            page_name: this.paper ? 'preliminary_edit' : 'preliminary_create',
            paper: this.paper ? paperSummary(this.paper) : null,
            definition,
        };
        this.response.template = 'preliminary_edit.html';
    }

    @param('paperId', Types.ObjectId, true)
    @post('definition', Types.Any)
    @post('published', Types.Boolean)
    async postSave(domainId: string, paperId: ObjectId | undefined, definition: unknown, published: boolean) {
        if (!paperId) paperId = await preliminary.add(domainId, definition, this.user._id, published);
        else await preliminary.edit(domainId, paperId, definition, published);
        this.response.body = { paperId };
        this.response.redirect = this.url('preliminary_detail', { paperId });
    }
}

class PreliminaryAttemptHandler extends Handler {
    @param('paperId', Types.ObjectId)
    @param('attemptId', Types.ObjectId)
    async get(domainId: string, paperId: ObjectId, attemptId: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const attempt = await preliminary.getAttempt(domainId, paperId, attemptId);
        if (attempt.owner !== this.user._id) throw new PreliminaryAttemptNotFoundError(attemptId);
        const revision = await preliminary.getRevisionById(domainId, attempt.revisionId);
        if (!revision) throw new PreliminaryAttemptNotFoundError(attemptId);
        this.UiContext.extraTitleContent = revision.title;
        this.response.body = {
            attempt,
            paper: {
                docId: paperId,
                revision: revision.revision,
                ...withQuestionNumbers(toPreliminaryReview(revision, attempt)),
            },
        };
        this.response.template = 'preliminary_attempt.html';
    }
}

export function apply(ctx: Context) {
    ctx.Route('preliminary_main', '/preliminary', PreliminaryMainHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('preliminary_create', '/preliminary/create', PreliminaryEditHandler);
    ctx.Route('preliminary_detail', '/preliminary/:paperId', PreliminaryDetailHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('preliminary_edit', '/preliminary/:paperId/edit', PreliminaryEditHandler);
    ctx.Route('preliminary_attempt', '/preliminary/:paperId/attempt/:attemptId', PreliminaryAttemptHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.injectUI('Nav', 'preliminary_main', { prefix: 'preliminary', before: 'contest_main' }, PERM.PERM_VIEW_PROBLEM);
}
