import { ObjectId } from 'mongodb';
import { Context } from '../context';
import {
    getRealnameStatus, isSuperAdmin, requiresRealname,
} from '../lib/realname';
import { PRIV } from '../model/builtin';
import * as realname from '../model/realname';
import user from '../model/user';
import {
    Handler, param, Types,
} from '../service/server';

class HomeRealnameHandler extends Handler {
    noCheckPermView = true;
    skipRealnameCheck = true;

    async get() {
        const status = getRealnameStatus(this.user);
        if (!isSuperAdmin(this.user) && (status === 'pending' || status === 'approved')) {
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
        await realname.review(id, this.user._id, 'revoke', reason.trim() || 'Revoked by administrator');
        this.back();
    }
}

/* locale strings are maintained in packages/hydrooj/locales */
/*
    'Real-name Verification': '实名认证',
    'Verification Result': '认证结果',
    'Real Name': '真实姓名',
    School: '学校',
    'Submit Verification': '提交认证',
    'Update Verification': '更新认证',
    Resubmit: '重新提交',
    Approve: '通过',
    Reject: '拒绝',
    Revoke: '撤销',
    Pending: '待审核',
    Approved: '已通过',
    Rejected: '已拒绝',
    'Not Submitted': '未提交',
    'Submitted At': '提交时间',
    'Reviewed At': '审核时间',
    Reviewer: '审核人',
    'Rejection Reason': '拒绝原因',
    'Please complete real-name verification before using this site.': '请先完成实名认证后再使用本站功能。',
    'Real-name verification is required before using this site.': '使用本站前必须完成实名认证。',
    'Your real-name verification is pending review.': '你的实名认证正在等待超级管理员审核。',
    'Your real-name verification has been approved.': '你的实名认证已通过。',
    'Your real-name verification was rejected.': '你的实名认证未通过。',
    'You are a super administrator and do not need real-name verification.': '你是超级管理员，无需进行实名认证。',
    'Please enter your legal name and school. A super administrator will review your application. You cannot use any site features until it is approved.':
        '请填写你的真实姓名与学校。超级管理员审核通过前，你将无法使用本站的任何实际功能。',
    'No real-name applications.': '暂无实名认证申请。',
    'Confirm approving this application?': '确认通过该申请？',
    'Confirm rejecting this application?': '确认拒绝该申请？',
    'Confirm revoking this approved application? The user will lose access until they pass review again.':
        '确认撤销该已通过的申请？用户将失去站点使用权，直至再次通过审核。',
    'Optional rejection reason': '拒绝原因（可选）',
    'Your real-name verification has already been approved.': '你的实名认证已经通过。',
    'This application is not pending review.': '该申请当前不在待审核状态。',
    'Real-name application {0} not found.': '实名认证申请 {0} 不存在。',
    home_realname: '实名认证',
    home_realname_result: '认证结果',
    manage_realname: '实名认证管理',
    'Real-name applications per page': '每页展示的实名认证申请数量',
    'Back to homepage': '返回首页',
    'Use your legal name. 2–64 characters.': '请填写法定姓名，2–64 个字符。',
    'Full official school name. 2–128 characters.': '请填写学校全称，2–128 个字符。',
    'After submission, a super administrator will review your real name and school.': '提交后，超级管理员将审核你的真实姓名与学校。',
    'You may update a pending application if you entered something incorrectly.': '若填写有误，可在审核前更新已提交的申请。',
    'Rejected applications can be corrected and submitted again.': '被拒绝的申请可以修改后再次提交。',
    'You can now use the site normally.': '你现在可以正常使用本站功能。',
};

const i18nZhTw = {
    'Real-name Verification': '實名認證',
    'Verification Result': '認證結果',
    'Real Name': '真實姓名',
    School: '學校',
    'Submit Verification': '提交認證',
    'Update Verification': '更新認證',
    Resubmit: '重新提交',
    Approve: '通過',
    Reject: '拒絕',
    Revoke: '撤銷',
    Pending: '待審核',
    Approved: '已通過',
    Rejected: '已拒絕',
    'Not Submitted': '未提交',
    'Submitted At': '提交時間',
    'Reviewed At': '審核時間',
    Reviewer: '審核人',
    'Rejection Reason': '拒絕原因',
    'Please complete real-name verification before using this site.': '請先完成實名認證後再使用本站功能。',
    'Real-name verification is required before using this site.': '使用本站前必須完成實名認證。',
    'Your real-name verification is pending review.': '你的實名認證正在等待超級管理員審核。',
    'Your real-name verification has been approved.': '你的實名認證已通過。',
    'Your real-name verification was rejected.': '你的實名認證未通過。',
    'You are a super administrator and do not need real-name verification.': '你是超級管理員，無需進行實名認證。',
    'Please enter your legal name and school. A super administrator will review your application. You cannot use any site features until it is approved.':
        '請填寫你的真實姓名與學校。超級管理員審核通過前，你將無法使用本站的任何實際功能。',
    'No real-name applications.': '暫無實名認證申請。',
    'Confirm approving this application?': '確認通過該申請？',
    'Confirm rejecting this application?': '確認拒絕該申請？',
    'Confirm revoking this approved application? The user will lose access until they pass review again.':
        '確認撤銷該已通過的申請？使用者將失去站點使用權，直至再次通過審核。',
    'Optional rejection reason': '拒絕原因（可選）',
    'Your real-name verification has already been approved.': '你的實名認證已經通過。',
    'This application is not pending review.': '該申請目前不在待審核狀態。',
    'Real-name application {0} not found.': '實名認證申請 {0} 不存在。',
    home_realname: '實名認證',
    home_realname_result: '認證結果',
    manage_realname: '實名認證管理',
    'Real-name applications per page': '每頁展示的實名認證申請數量',
    'Back to homepage': '返回首頁',
    'Use your legal name. 2–64 characters.': '請填寫法定姓名，2–64 個字元。',
    'Full official school name. 2–128 characters.': '請填寫學校全稱，2–128 個字元。',
    'After submission, a super administrator will review your real name and school.': '提交後，超級管理員將審核你的真實姓名與學校。',
    'You may update a pending application if you entered something incorrectly.': '若填寫有誤，可在審核前更新已提交的申請。',
    'Rejected applications can be corrected and submitted again.': '被拒絕的申請可以修改後再次提交。',
    'You can now use the site normally.': '你現在可以正常使用本站功能。',
};
*/

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
        (h) => requiresRealname(h.user),
    );
}
