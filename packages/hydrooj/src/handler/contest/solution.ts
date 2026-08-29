import { ObjectId } from 'mongodb';
import {
    ContestNotEndedError, ContestNotFoundError, PermissionError,
} from '../../error';
import { PERM } from '../../model/builtin';
import * as contest from '../../model/contest';
import contestSolution from '../../model/contest/solution';
import user from '../../model/user';
import { param, route, Types } from '../../service/server';
import { ContestDetailBaseHandler } from './base';

export class ContestSolutionHandler extends ContestDetailBaseHandler {
    @param('tid', Types.ObjectId)
    async prepare(domainId: string, tid: ObjectId) {
        if (this.tdoc.rule === 'homework') throw new ContestNotFoundError(domainId, tid);
    }

    @param('tid', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    @param('sid', Types.ObjectId, true)
    async get(domainId: string, tid: ObjectId, page = 1, sid?: ObjectId) {
        if (this.tdoc.rule === 'homework') throw new ContestNotFoundError(domainId, tid);
        const manager = contestSolution.isManager(this.user, this.tdoc);
        if (!manager && !contest.isDone(this.tdoc)) throw new ContestNotEndedError(domainId, tid);
        let [csdocs, pcount, cscount] = await this.paginate(contestSolution.getMulti(domainId, tid), page, 'solution');
        if (sid) {
            const selected = await contestSolution.get(domainId, sid);
            contestSolution.ensureParent(selected, tid, domainId);
            csdocs = [selected];
        }
        const uids = [this.tdoc.owner];
        const ids = [];
        for (const doc of csdocs) {
            ids.push(doc.docId);
            uids.push(doc.owner);
            for (const reply of doc.reply || []) uids.push(reply.owner);
        }
        this.response.template = 'contest_solution.html';
        this.response.body = {
            tdoc: this.tdoc, tsdoc: this.tsdocAsPublic(), csdocs, page, pcount, cscount,
            udict: await user.getList(domainId, uids),
            cssdict: await contestSolution.getListStatus(domainId, ids, this.user._id), sid, canManage: manager,
        };
    }

    @param('tid', Types.ObjectId)
    @param('content', Types.Content)
    async postSubmit(domainId: string, tid: ObjectId, content: string) {
        if (!contestSolution.isManager(this.user, this.tdoc)) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
        const csid = await contestSolution.add(domainId, tid, this.user._id, content);
        this.back({ csid });
    }

    @param('tid', Types.ObjectId)
    @param('content', Types.Content)
    @param('psid', Types.ObjectId)
    async postEditSolution(domainId: string, tid: ObjectId, content: string, psid: ObjectId) {
        const doc = await contestSolution.get(domainId, psid);
        contestSolution.ensureParent(doc, tid, domainId);
        if (!contestSolution.isManager(this.user, this.tdoc)) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
        this.back({ csdoc: await contestSolution.edit(domainId, psid, content) });
    }

    @param('tid', Types.ObjectId)
    @param('psid', Types.ObjectId)
    async postDeleteSolution(domainId: string, tid: ObjectId, psid: ObjectId) {
        const doc = await contestSolution.get(domainId, psid);
        contestSolution.ensureParent(doc, tid, domainId);
        if (!contestSolution.isManager(this.user, this.tdoc)) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
        await contestSolution.del(domainId, psid);
        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('psid', Types.ObjectId)
    @param('content', Types.Content)
    async postReply(domainId: string, tid: ObjectId, psid: ObjectId, content: string) {
        if (!contestSolution.canManageOrDone(this.user, this.tdoc)) throw new ContestNotEndedError(domainId, tid);
        this.checkPerm(PERM.PERM_REPLY_PROBLEM_SOLUTION);
        const doc = await contestSolution.get(domainId, psid);
        contestSolution.ensureParent(doc, tid, domainId);
        await contestSolution.reply(domainId, psid, this.user._id, content);
        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('psid', Types.ObjectId)
    @param('psrid', Types.ObjectId)
    @param('content', Types.Content)
    async postEditReply(domainId: string, tid: ObjectId, psid: ObjectId, psrid: ObjectId, content: string) {
        if (!contestSolution.canManageOrDone(this.user, this.tdoc)) throw new ContestNotEndedError(domainId, tid);
        const [doc, reply] = await contestSolution.getReply(domainId, psid, psrid);
        contestSolution.ensureParent(doc, tid, domainId);
        contestSolution.ensureReply(reply, domainId, psid);
        if (!this.user.own(reply) || !this.user.hasPerm(PERM.PERM_EDIT_PROBLEM_SOLUTION_REPLY_SELF)) {
            throw new PermissionError(PERM.PERM_EDIT_PROBLEM_SOLUTION_REPLY_SELF);
        }
        await contestSolution.editReply(domainId, psid, psrid, content);
        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('psid', Types.ObjectId)
    @param('psrid', Types.ObjectId)
    async postDeleteReply(domainId: string, tid: ObjectId, psid: ObjectId, psrid: ObjectId) {
        if (!contestSolution.canManageOrDone(this.user, this.tdoc)) throw new ContestNotEndedError(domainId, tid);
        const [doc, reply] = await contestSolution.getReply(domainId, psid, psrid);
        contestSolution.ensureParent(doc, tid, domainId);
        contestSolution.ensureReply(reply, domainId, psid);
        if (this.user.own(reply)) this.checkPerm(PERM.PERM_DELETE_PROBLEM_SOLUTION_REPLY_SELF);
        else this.checkPerm(PERM.PERM_DELETE_PROBLEM_SOLUTION_REPLY);
        await contestSolution.delReply(domainId, psid, psrid);
        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('psid', Types.ObjectId)
    async postUpvote(domainId: string, tid: ObjectId, psid: ObjectId) {
        if (!contestSolution.canManageOrDone(this.user, this.tdoc)) throw new ContestNotEndedError(domainId, tid);
        this.checkPerm(PERM.PERM_VOTE_PROBLEM_SOLUTION);
        const doc = await contestSolution.get(domainId, psid);
        contestSolution.ensureParent(doc, tid, domainId);
        const updated = await contestSolution.vote(domainId, psid, this.user._id, 1);
        this.back({ vote: updated.vote, user_vote: 1 });
    }

    @param('tid', Types.ObjectId)
    @param('psid', Types.ObjectId)
    async postDownvote(domainId: string, tid: ObjectId, psid: ObjectId) {
        if (!contestSolution.canManageOrDone(this.user, this.tdoc)) throw new ContestNotEndedError(domainId, tid);
        this.checkPerm(PERM.PERM_VOTE_PROBLEM_SOLUTION);
        const doc = await contestSolution.get(domainId, psid);
        contestSolution.ensureParent(doc, tid, domainId);
        const updated = await contestSolution.vote(domainId, psid, this.user._id, -1);
        this.back({ vote: updated.vote, user_vote: -1 });
    }
}

export class ContestSolutionRawHandler extends ContestDetailBaseHandler {
    @param('tid', Types.ObjectId)
    @param('csid', Types.ObjectId)
    @route('csrid', Types.ObjectId, true)
    async get(domainId: string, tid: ObjectId, csid: ObjectId, csrid?: ObjectId) {
        if (this.tdoc.rule === 'homework') throw new ContestNotFoundError(domainId, tid);
        if (!contestSolution.canManageOrDone(this.user, this.tdoc)) throw new ContestNotEndedError(domainId, tid);
        if (csrid) {
            const [doc, reply] = await contestSolution.getReply(domainId, csid, csrid);
            contestSolution.ensureParent(doc, tid, domainId);
            contestSolution.ensureReply(reply, domainId, csid);
            this.response.body = reply.content;
        } else {
            const doc = await contestSolution.get(domainId, csid);
            contestSolution.ensureParent(doc, tid, domainId);
            this.response.body = doc.content;
        }
        this.response.type = 'text/markdown';
    }
}
