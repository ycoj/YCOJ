import { ObjectId } from 'mongodb';
import { Context } from '../context';
import type { ProblemFeedbackStatus } from '../interface';
import { PRIV } from '../model/builtin';
import problem from '../model/problem';
import * as problemFeedback from '../model/problemFeedback';
import user from '../model/user';
import { Handler, param, Types } from '../service/server';
import { ProblemDetailHandler } from './problem';

class ProblemFeedbackSubmitHandler extends ProblemDetailHandler {
    @param('content', Types.Content)
    async post(domainId: string, content: string) {
        await this.limitRate('problem_feedback_submit', 60, 10, '{{user}}');
        const feedback = await problemFeedback.add(domainId, this.pdoc.docId, this.user._id, content);
        this.back({ feedback });
    }
}

class ProblemFeedbackManageHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    @param('page', Types.PositiveInt, true)
    @param('status', Types.Range(['all', 'pending', 'processing', 'resolved', 'invalid']), true)
    async get(
        domainId: string,
        page = 1,
        status: 'all' | ProblemFeedbackStatus = 'pending',
    ) {
        const query = status === 'all' ? { domainId } : { domainId, status };
        const [docs, pcount, count] = await this.paginate(
            problemFeedback.getMulti(query),
            page,
            this.ctx.setting.get('pagination.problem_feedback') || 20,
        );
        const [pdict, udict] = await Promise.all([
            problem.getList(domainId, docs.map((doc) => doc.pid), true, false),
            user.getList(domainId, docs.flatMap((doc) => [doc.owner, doc.reviewedBy].filter(Boolean) as number[])),
        ]);
        this.response.body = {
            docs,
            page,
            pcount,
            count,
            pdict,
            udict,
            status,
            page_name: 'manage_problem_feedback',
        };
    }

    @param('id', Types.ObjectId)
    @param('status', Types.Range(['pending', 'processing', 'resolved', 'invalid']))
    async postUpdateStatus({ domainId }, id: ObjectId, status: ProblemFeedbackStatus) {
        const feedback = await problemFeedback.updateStatus(domainId, id, status, this.user._id);
        this.back({ feedback });
    }
}

export async function apply(ctx: Context) {
    ctx.Route('problem_feedback', '/p/:pid/feedback', ProblemFeedbackSubmitHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('manage_problem_feedback', '/manage/problem-feedback', ProblemFeedbackManageHandler);
}
