import { type Filter } from 'mongodb';
import { Context } from '../context';
import { AwardRealnameRequiredError } from '../error';
import { isRealnameVerified } from '../lib/realname';
import { PRIV } from '../model/builtin';
import * as oier from '../model/oier';
import type { OierDoc } from '../model/oier';
import user from '../model/user';
import {
    Handler, param, Types,
} from '../service/server';

class HomeAwardHandler extends Handler {
    async get() {
        if (!isRealnameVerified(this.user) || !this.user.realName) {
            this.response.template = 'home_award.html';
            this.response.body = {
                page_name: 'home_award',
                verified: false,
            };
            return;
        }
        const bound = this.user.oierId ? await oier.get(this.user.oierId) : null;
        const records = bound ? await oier.getRecords(bound._id) : [];
        this.response.template = 'home_award.html';
        if (bound) {
            this.response.body = {
                page_name: 'home_award',
                verified: true,
                bound,
                records,
            };
            return;
        }
        const others = this.request.query.others === '1' || this.request.query.others === 'true';
        const page = Math.max(1, +this.request.query.page || 1);
        const pageSize = this.ctx.setting.get('pagination.award') || 20;
        const result = await oier.findCandidates({
            name: this.user.realName,
            school: this.user.realnameSchool || this.user.school || '',
            others,
            page,
            pageSize,
        });
        const previews = await oier.getRecordsByOierIds(result.docs.map((d) => d._id));
        this.response.body = {
            page_name: 'home_award',
            verified: true,
            bound: null,
            records: [],
            oiers: result.docs,
            previews,
            page,
            numPages: result.numPages,
            count: result.count,
            preferredCount: result.preferredCount,
            othersCount: result.othersCount,
            showingOthers: result.showingOthers,
            realName: this.user.realName,
            school: this.user.realnameSchool || '',
        };
    }

    @param('oierId', Types.Int)
    async post({ }, oierId: number) {
        await this.limitRate('award_bind', 60, 5, '{{user}}');
        if (!isRealnameVerified(this.user) || !this.user.realName) throw new AwardRealnameRequiredError();
        await oier.bind(this.user._id, oierId, this.user.realName);
        this.response.redirect = this.url('home_award');
    }
}

class SystemAwardHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    @param('page', Types.PositiveInt, true)
    @param('uname', Types.String, true)
    async get({ }, page = 1, uname = '') {
        const query: { uid?: Filter<OierDoc>['uid'] } = {};
        uname = uname.trim();
        if (uname) query.uid = { $in: await user.getUidsByUnameSubstring(uname) };
        const [odocs, numPages, count] = await oier.paginateBound(
            query,
            page,
            this.ctx.setting.get('pagination.award') || 20,
        );
        const udict = await user.getList(this.args.domainId, odocs.map((doc) => doc.uid).filter(Boolean) as number[]);
        this.response.template = 'manage_award.html';
        this.response.body = {
            page_name: 'manage_award',
            odocs,
            udict,
            page,
            numPages,
            count,
            filterUname: uname,
        };
    }

    @param('uid', Types.Int)
    async postUnbind({ }, uid: number) {
        await oier.unbindByUid(uid);
        this.back();
    }
}

export async function apply(ctx: Context) {
    ctx.Route('home_award', '/home/award', HomeAwardHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('manage_award', '/manage/award', SystemAwardHandler);
    ctx.injectUI('ControlPanel', 'manage_award', {}, PRIV.PRIV_EDIT_SYSTEM);
    ctx.injectUI(
        'UserDropdown',
        'home_award',
        () => ({
            icon: 'award',
            displayName: 'Award Certification',
        }),
        PRIV.PRIV_USER_PROFILE,
    );
}
