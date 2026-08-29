import { ObjectId } from 'mongodb';
import {
    ContestNotEndedError, ContestNotFoundError, PermissionError,
} from '../../error';
import { ContestSolutionDoc } from '../../interface';
import { PERM } from '../../model/builtin';
import * as contest from '../../model/contest';
import contestSolution from '../../model/contest/solution';
import user from '../../model/user';
import { param, Types } from '../../service/server';
import { ContestDetailBaseHandler } from './base';

export function ensureContestSolutionFeature(tdoc: { rule: string }, domainId: string, tid: ObjectId) {
    if (tdoc.rule === 'homework') throw new ContestNotFoundError(domainId, tid);
}

export async function loadContestSolutions(handler: ContestDetailBaseHandler, domainId: string, tid: ObjectId) {
    if (handler.tdoc.rule === 'homework') return;
    const manager = contestSolution.isManager(handler.user, handler.tdoc);
    if (!manager && !contest.isDone(handler.tdoc)) return;
    const csdocs = await contestSolution.getMulti(domainId, tid)
        .project({ title: 1, docId: 1, owner: 1 })
        .toArray();
    const udict = await user.getList(domainId, csdocs.map((doc) => doc.owner));
    handler.response.body = {
        ...handler.response.body,
        csdocs,
        canManage: manager,
        showContestSolutions: true,
        udict: Object.assign(handler.response.body.udict || {}, udict),
    };
}

export class ContestSolutionEditHandler extends ContestDetailBaseHandler {
    csdoc?: ContestSolutionDoc;

    @param('tid', Types.ObjectId)
    @param('sid', Types.ObjectId, true)
    async prepare(domainId: string, tid: ObjectId, sid?: ObjectId) {
        ensureContestSolutionFeature(this.tdoc, domainId, tid);
        if (!contestSolution.isManager(this.user, this.tdoc)) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
        if (!sid) return;
        this.csdoc = await contestSolution.get(domainId, sid);
        contestSolution.ensureParent(this.csdoc, tid, domainId);
    }

    async get() {
        this.response.template = 'contest_solution_edit.html';
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: this.tsdocAsPublic(),
            csdoc: this.csdoc || {},
            canManage: true,
        };
    }

    @param('tid', Types.ObjectId)
    @param('title', Types.Title)
    @param('content', Types.Content)
    async post(domainId: string, tid: ObjectId, title: string, content: string) {
        const sid = this.csdoc
            ? (await contestSolution.edit(domainId, this.csdoc.docId, title, content)).docId
            : await contestSolution.add(domainId, tid, this.user._id, title, content);
        this.response.body = { sid };
        this.response.redirect = this.url('contest_solution_detail', { tid, sid });
    }

    @param('tid', Types.ObjectId)
    async postDelete(domainId: string, tid: ObjectId) {
        if (!this.csdoc) throw new ContestNotFoundError(domainId, tid);
        await contestSolution.del(domainId, this.csdoc.docId);
        this.response.redirect = this.url('contest_detail', { tid });
    }
}

export class ContestSolutionDetailHandler extends ContestDetailBaseHandler {
    csdoc: ContestSolutionDoc;

    @param('tid', Types.ObjectId)
    @param('sid', Types.ObjectId)
    async prepare(domainId: string, tid: ObjectId, sid: ObjectId) {
        ensureContestSolutionFeature(this.tdoc, domainId, tid);
        if (!contestSolution.canManageOrDone(this.user, this.tdoc)) throw new ContestNotEndedError(domainId, tid);
        this.csdoc = await contestSolution.get(domainId, sid);
        contestSolution.ensureParent(this.csdoc, tid, domainId);
    }

    @param('tid', Types.ObjectId)
    async get(domainId: string) {
        this.response.template = 'contest_solution_detail.html';
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: this.tsdocAsPublic(),
            csdoc: this.csdoc,
            canManage: contestSolution.isManager(this.user, this.tdoc),
            udict: await user.getList(domainId, [this.tdoc.owner, this.csdoc.owner]),
        };
    }

    @param('tid', Types.ObjectId)
    async postDelete(domainId: string, tid: ObjectId) {
        if (!contestSolution.isManager(this.user, this.tdoc)) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
        await contestSolution.del(domainId, this.csdoc.docId);
        this.response.redirect = this.url('contest_detail', { tid });
    }
}
