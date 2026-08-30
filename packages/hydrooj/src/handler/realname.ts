import { ObjectId } from 'mongodb';
import { Context } from '../context';
import type { RealnameApplication } from '../interface';
import {
    getRealnameGraceUntil, getRealnameStatus, getRealnameSubmittedAt, isSuperAdmin,
    isWithinRealnameGrace, requiresRealname,
    type RealnameUserLike,
} from '../lib/realname';
import { PRIV } from '../model/builtin';
import * as realname from '../model/realname';
import user from '../model/user';
import {
    Handler, param, Types,
} from '../service/server';

async function realnameGrace(udoc: RealnameUserLike, latest: RealnameApplication | null) {
    let fallbackSubmittedAt = latest?.submittedAt ?? null;
    if (!getRealnameSubmittedAt(udoc) && udoc._id) {
        const earliest = await realname.getEarliestByUid(udoc._id);
        fallbackSubmittedAt = earliest?.submittedAt ?? fallbackSubmittedAt;
        if (fallbackSubmittedAt) {
            await user.setById(udoc._id, { realnameSubmittedAt: fallbackSubmittedAt });
        }
    }
    return {
        inGrace: isWithinRealnameGrace(udoc, new Date(), fallbackSubmittedAt),
        graceUntil: getRealnameGraceUntil(udoc, fallbackSubmittedAt),
    };
}

class HomeRealnameHandler extends Handler {
    noCheckPermView = true;
    skipRealnameCheck = true;

    async get() {
        const status = getRealnameStatus(this.user);
        if (!isSuperAdmin(this.user) && status === 'approved') {
            this.response.redirect = this.url('home_realname_result');
            return;
        }
        const latest = this.user._id ? await realname.getLatestByUid(this.user._id) : null;
        this.response.template = 'home_realname.html';
        this.response.body = {
            page_name: 'home_realname',
            status,
            exempt: isSuperAdmin(this.user),
            application: latest,
            ...await realnameGrace(this.user, latest),
            realName: this.user.realName || latest?.realName || '',
            school: this.user.realnameSchool || this.user.school || latest?.school || '',
        };
    }

    @param('realName', Types.Title)
    @param('school', Types.ShortString)
    async post({ }, realName: string, school: string) {
        await this.limitRate('realname_submit', 60, 10, '{{user}}');
        await realname.submit(this.user._id, realName, school);
        this.response.redirect = this.url('home_realname_result');
    }
}

class HomeRealnameResultHandler extends Handler {
    noCheckPermView = true;
    skipRealnameCheck = true;

    async get() {
        const status = getRealnameStatus(this.user);
        if (!isSuperAdmin(this.user) && status === 'none') {
            this.response.redirect = this.url('home_realname');
            return;
        }
        const latest = this.user._id ? await realname.getLatestByUid(this.user._id) : null;
        this.response.template = 'home_realname_result.html';
        this.response.body = {
            page_name: 'home_realname_result',
            status,
            exempt: isSuperAdmin(this.user),
            application: latest,
            ...await realnameGrace(this.user, latest),
        };
    }
}

class SystemRealnameHandler extends Handler {
    skipRealnameCheck = true;

    async prepare() {
        this.checkPriv(PRIV.PRIV_ALL);
    }

    @param('page', Types.PositiveInt, true)
    @param('status', Types.Range(['all', 'pending', 'approved', 'rejected']), true)
    async get({ }, page = 1, status = 'pending') {
        const query = status === 'all' ? {} : { status } as { status: 'pending' | 'approved' | 'rejected' };
        const [rdocs, numPages, count] = await this.paginate(
            realname.getMulti(query).sort({ submittedAt: -1 }),
            page,
            'realname',
        );
        const udict = await user.getList(this.args.domainId, rdocs.map((doc) => [
            doc.uid,
            doc.reviewedBy,
        ].filter(Boolean) as number[]).flat());
        this.response.template = 'manage_realname.html';
        this.response.body = {
            page_name: 'manage_realname',
            rdocs,
            udict,
            page,
            numPages,
            count,
            filterStatus: status,
        };
    }

    @param('id', Types.ObjectId)
    async postApprove({ }, id: ObjectId) {
        await realname.review(id, this.user._id, 'approve');
        this.back();
    }

    @param('id', Types.ObjectId)
    @param('reason', Types.String, true)
    async postReject({ }, id: ObjectId, reason = '') {
        await realname.review(id, this.user._id, 'reject', reason.trim());
        this.back();
    }

    @param('id', Types.ObjectId)
    @param('reason', Types.String, true)
    async postRevoke({ }, id: ObjectId, reason = '') {
        await realname.review(id, this.user._id, 'revoke', reason.trim() || this.translate('Revoked by administrator'));
        this.back();
    }
}

export async function apply(ctx: Context) {
    ctx.Route('home_realname', '/home/realname', HomeRealnameHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('home_realname_result', '/home/realname/result', HomeRealnameResultHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('manage_realname', '/manage/realname', SystemRealnameHandler);
    ctx.injectUI('ControlPanel', 'manage_realname', {}, PRIV.PRIV_ALL);
    ctx.injectUI(
        'UserDropdown',
        'home_realname',
        () => ({
            icon: 'user',
            displayName: 'Real-name Verification',
        }),
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.injectUI(
        'Notification',
        'Please complete real-name verification before using this site.',
        { type: 'warn' },
        (h) => requiresRealname(h.user) && !isWithinRealnameGrace(h.user),
    );
    ctx.injectUI(
        'Notification',
        'Your real-name verification is pending review. You may use the site for seven days after submission.',
        { type: 'note' },
        (h) => getRealnameStatus(h.user) === 'pending' && isWithinRealnameGrace(h.user),
    );
    ctx.injectUI(
        'Notification',
        'Your real-name verification was rejected. Please resubmit before the seven-day grace period ends.',
        { type: 'warn' },
        (h) => getRealnameStatus(h.user) === 'rejected' && isWithinRealnameGrace(h.user),
    );
}
