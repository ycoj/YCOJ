import { pick } from 'lodash';
import moment from 'moment-timezone';
import { ObjectId } from 'mongodb';
import { getAlphabeticId } from '@hydrooj/utils/lib/utils';
import { NotAssignedError } from '../../error';
import { ContestStatusDoc, Tdoc } from '../../interface';
import { PERM } from '../../model/builtin';
import * as contest from '../../model/contest';
import user from '../../model/user';
import { Handler, param, Types } from '../../service/server';

export class ContestDetailBaseHandler extends Handler {
    tdoc?: Tdoc;
    tsdoc?: ContestStatusDoc;

    @param('tid', Types.ObjectId, true)
    async __prepare(domainId: string, tid: ObjectId) {
        if (!tid) return; // ProblemDetailHandler also extends from ContestDetailBaseHandler
        [this.tdoc, this.tsdoc] = await Promise.all([
            contest.get(domainId, tid),
            contest.getStatus(domainId, tid, this.user._id),
        ]);
        if (this.tdoc.assign?.length && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST)) {
            const groups = await user.listGroup(domainId, this.user._id);
            if (!new Set(this.tdoc.assign).intersection(new Set(groups.map((i) => i.name))).size) {
                throw new NotAssignedError('contest', tid);
            }
        }
        if (this.tdoc.duration && this.tsdoc?.startAt) {
            this.tsdoc.endAt = moment.min([
                moment(this.tsdoc.startAt).add(this.tdoc.duration, 'hours'),
                moment(this.tdoc.endAt),
                ...(this.tsdoc.endAt ? [moment(this.tsdoc.endAt)] : []),
            ]).toDate();
        }
    }

    tsdocAsPublic() {
        if (!this.tsdoc) return null;
        return pick(this.tsdoc, ['attend', 'subscribe', 'startAt', ...(this.tdoc.duration || this.tsdoc.endAt ? ['endAt'] : [])]);
    }

    @param('tid', Types.ObjectId, true)
    async after(domainId: string, tid: ObjectId) {
        if (!tid || this.tdoc.rule === 'homework') return;
        if (this.request.json || !this.response.template) return;
        const pdoc = 'pdoc' in this ? (this as any).pdoc : {};
        this.response.body.overrideNav = [
            {
                name: 'contest_main',
                args: {},
                displayName: 'Back to contest list',
                checker: () => true,
            },
            {
                name: 'contest_detail',
                displayName: this.tdoc.title,
                args: { tid, prefix: 'contest_detail' },
                checker: () => true,
            },
            {
                name: 'contest_problemlist',
                args: { tid, prefix: 'contest_problemlist' },
                checker: () => this.tsdoc?.attend || contest.isDone(this.tdoc),
            },
            {
                name: 'contest_print',
                args: { tid, prefix: 'contest_print' },
                checker: () => this.tdoc.allowPrint && (this.tsdoc?.attend || this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST)),
            },
            {
                name: 'contest_scoreboard',
                args: { tid, prefix: 'contest_scoreboard' },
                checker: () => contest.canShowScoreboard.call(this, this.tdoc, true),
            },
            {
                name: 'contest_solution',
                args: { tid, prefix: 'contest_solution' },
                checker: () => contest.isDone(this.tdoc) || this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
            },
            {
                name: 'problem_detail',
                displayName: `${getAlphabeticId(this.tdoc.pids.indexOf(pdoc.docId))}. ${pdoc.title}`,
                args: { query: { tid }, pid: pdoc.docId, prefix: 'contest_detail_problem' },
                checker: () => 'pdoc' in this,
            },
        ];
    }
}
