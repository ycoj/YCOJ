import assert from 'assert';
import { describe, it } from 'node:test';
import {
    buildLatestRealnameListPipeline, canSubmitApplication, canTransition, getRealnameGraceUntil,
    getRealnameStatus, getRealnameSubmittedAt, handlerAllowsUnverified, hasRealnameAccess,
    isRealnameExempt, isRealnameVerified, isWithinRealnameGrace, nextRealnameRoute, parseRealnameFields,
    REALNAME_GRACE_MS, requiresRealname, reviewStatusFor, shouldBlockUnverifiedAccess,
} from '../src/lib/realname';

const PRIV_USER_PROFILE = 1 << 2;
const PRIV_CREATE_FILE = 1 << 16;
const PRIV_SEND_MESSAGE = 1 << 24;
const PRIV_JUDGE = 1 << 9;
const PRIV_ALL = -1;
const PRIV_DEFAULT = PRIV_USER_PROFILE + PRIV_CREATE_FILE + PRIV_SEND_MESSAGE;

const now = new Date('2026-08-30T12:00:00.000Z');
const withinGrace = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
const expired = new Date(now.getTime() - REALNAME_GRACE_MS - 1);

const guest = { _id: 0, priv: 0 };
const user = { _id: 2, priv: PRIV_DEFAULT, realnameStatus: 'none' };
const pending = { ...user, realnameStatus: 'pending' };
const pendingInGrace = { ...pending, realnameSubmittedAt: withinGrace };
const pendingExpired = { ...pending, realnameSubmittedAt: expired };
const approved = { ...user, realnameStatus: 'approved' };
const rejected = { ...user, realnameStatus: 'rejected' };
const rejectedInGrace = { ...rejected, realnameSubmittedAt: withinGrace };
const rejectedExpired = { ...rejected, realnameSubmittedAt: expired };
const superAdmin = { _id: 3, priv: PRIV_ALL, realnameStatus: 'none' };
const judge = {
    _id: 4,
    priv: PRIV_USER_PROFILE | PRIV_JUDGE,
    realnameStatus: 'none',
};

function handler(name: string, skipRealnameCheck = false) {
    const Ctor = { name: `${name}Handler` };
    return { constructor: Ctor, skipRealnameCheck };
}

describe('realname status helpers', () => {
    it('treats missing or unknown values as none', () => {
        assert.equal(getRealnameStatus({}), 'none');
        assert.equal(getRealnameStatus({ realnameStatus: 'unknown' }), 'none');
        assert.equal(getRealnameStatus(pending), 'pending');
    });

    it('exempts only super admins and judge service accounts', () => {
        assert.equal(isRealnameExempt(superAdmin), true);
        assert.equal(isRealnameExempt(judge), true);
        assert.equal(isRealnameExempt(user), false);
        assert.equal(isRealnameExempt(guest), false);
    });

    it('treats approved users and exempt accounts as verified', () => {
        assert.equal(isRealnameVerified(approved), true);
        assert.equal(isRealnameVerified(superAdmin), true);
        assert.equal(isRealnameVerified(pending), false);
        assert.equal(isRealnameVerified(user), false);
    });

    it('requires verification only for logged-in unverified users', () => {
        assert.equal(requiresRealname(user), true);
        assert.equal(requiresRealname(pending), true);
        assert.equal(requiresRealname(pendingInGrace), true);
        assert.equal(requiresRealname(rejected), true);
        assert.equal(requiresRealname(approved), false);
        assert.equal(requiresRealname(superAdmin), false);
        assert.equal(requiresRealname(judge), false);
        assert.equal(requiresRealname(guest), false);
    });

    it('routes unverified users to submit or result', () => {
        assert.equal(nextRealnameRoute(user), 'home_realname');
        assert.equal(nextRealnameRoute(pending), 'home_realname_result');
        assert.equal(nextRealnameRoute(rejected), 'home_realname_result');
        assert.equal(nextRealnameRoute(approved), 'home_realname_result');
    });
});

describe('realname access gate', () => {
    it('blocks unverified users from ordinary handlers', () => {
        assert.equal(shouldBlockUnverifiedAccess(user, handler('Home'), now), true);
        assert.equal(shouldBlockUnverifiedAccess(pending, handler('ProblemMain'), now), true);
        assert.equal(shouldBlockUnverifiedAccess(pendingExpired, handler('ProblemMain'), now), true);
        assert.equal(shouldBlockUnverifiedAccess(rejectedExpired, handler('Home'), now), true);
        assert.equal(shouldBlockUnverifiedAccess(approved, handler('Home'), now), false);
        assert.equal(shouldBlockUnverifiedAccess(superAdmin, handler('Home'), now), false);
        assert.equal(shouldBlockUnverifiedAccess(guest, handler('Home'), now), false);
    });

    it('allows pending and rejected users during the seven-day grace period', () => {
        assert.equal(isWithinRealnameGrace(pendingInGrace, now), true);
        assert.equal(isWithinRealnameGrace(rejectedInGrace, now), true);
        assert.equal(isWithinRealnameGrace(pendingExpired, now), false);
        assert.equal(isWithinRealnameGrace(rejectedExpired, now), false);
        assert.equal(isWithinRealnameGrace(pending, now), false);
        assert.equal(isWithinRealnameGrace(approved, now), false);
        assert.equal(hasRealnameAccess(pendingInGrace, now), true);
        assert.equal(hasRealnameAccess(rejectedInGrace, now), true);
        assert.equal(hasRealnameAccess(pendingExpired, now), false);
        assert.equal(shouldBlockUnverifiedAccess(pendingInGrace, handler('ProblemMain'), now), false);
        assert.equal(shouldBlockUnverifiedAccess(rejectedInGrace, handler('Home'), now), false);
        assert.equal(
            getRealnameGraceUntil(pendingInGrace)?.getTime(),
            withinGrace.getTime() + REALNAME_GRACE_MS,
        );
    });

    it('falls back to the application submittedAt when the user field is missing', () => {
        assert.equal(isWithinRealnameGrace(pending, now, withinGrace), true);
        assert.equal(isWithinRealnameGrace(pending, now, expired), false);
        assert.equal(isWithinRealnameGrace(rejected, now, withinGrace), true);
        assert.equal(
            getRealnameGraceUntil(pending, withinGrace)?.getTime(),
            withinGrace.getTime() + REALNAME_GRACE_MS,
        );
        assert.equal(getRealnameSubmittedAt(pending, withinGrace)?.getTime(), withinGrace.getTime());
        assert.equal(getRealnameSubmittedAt(pendingInGrace, now)?.getTime(), withinGrace.getTime());
    });

    it('ends the grace period at the seven-day boundary', () => {
        const submittedAt = new Date(now.getTime() - REALNAME_GRACE_MS);
        const atBoundary = { ...pending, realnameSubmittedAt: submittedAt };
        assert.equal(isWithinRealnameGrace(atBoundary, now), false);
        assert.equal(isWithinRealnameGrace(atBoundary, new Date(now.getTime() - 1)), true);
    });

    it('allows auth, realname, and utility handlers before approval', () => {
        for (const name of [
            'UserLogin', 'UserLogout', 'UserRegister', 'HomeRealname',
            'HomeRealnameResult', 'HomeSecurity', 'Nav', 'SetTheme',
        ]) {
            assert.equal(shouldBlockUnverifiedAccess(user, handler(name, true), now), false, name);
        }
    });

    it('honors skipRealnameCheck on unknown handlers', () => {
        assert.equal(shouldBlockUnverifiedAccess(user, handler('SomethingElse', true), now), false);
        assert.equal(shouldBlockUnverifiedAccess(user, handler('SomethingElse'), now), true);
        assert.equal(shouldBlockUnverifiedAccess(user, handler('WebsocketEventsConnectionManager', true), now), false);
        assert.equal(handlerAllowsUnverified(handler('HomeRealname', true)), true);
        assert.equal(handlerAllowsUnverified(handler('HomeRealname')), false);
    });
});

describe('realname application transitions', () => {
    it('allows submit from none, pending, or rejected, but not approved', () => {
        assert.equal(canSubmitApplication('none'), true);
        assert.equal(canSubmitApplication('pending'), true);
        assert.equal(canSubmitApplication('rejected'), true);
        assert.equal(canSubmitApplication('approved'), false);
        assert.equal(canTransition('approved', 'submit'), false);
    });

    it('allows approve and reject only while pending', () => {
        assert.equal(canTransition('pending', 'approve'), true);
        assert.equal(canTransition('pending', 'reject'), true);
        assert.equal(canTransition('approved', 'approve'), false);
        assert.equal(canTransition('rejected', 'reject'), false);
        assert.equal(canTransition('none', 'approve'), false);
    });

    it('allows revoke only after approval', () => {
        assert.equal(canTransition('approved', 'revoke'), true);
        assert.equal(canTransition('pending', 'revoke'), false);
        assert.equal(reviewStatusFor('approve'), 'approved');
        assert.equal(reviewStatusFor('reject'), 'rejected');
        assert.equal(reviewStatusFor('revoke'), 'rejected');
    });
});

describe('realname admin list query', () => {
    it('keeps one row per user and applies status after selecting the latest application', () => {
        const pipeline = buildLatestRealnameListPipeline(
            { uid: { $in: [2] }, status: 'pending' },
            1,
            50,
        ) as any[];
        assert.deepEqual(pipeline.map((stage) => Object.keys(stage)[0]), [
            '$match', '$group', '$replaceRoot', '$match', '$sort', '$facet',
        ]);
        assert.deepEqual(pipeline[0], { $match: { uid: { $in: [2] } } });
        assert.equal(pipeline[1].$group._id, '$uid');
        assert.deepEqual(pipeline[1].$group.doc.$top.sortBy, { submittedAt: -1, _id: -1 });
        assert.deepEqual(pipeline[3], { $match: { status: 'pending' } });
    });

    it('lists each user once when status is all, including after revoke and resubmit', () => {
        const pipeline = buildLatestRealnameListPipeline({}, 2, 20) as any[];
        assert.equal(pipeline.some((stage) => stage.$match && 'status' in stage.$match), false);
        assert.equal(pipeline[0].$group._id, '$uid');
        assert.deepEqual(pipeline.at(-1).$facet.docs, [{ $skip: 20 }, { $limit: 20 }]);
    });
});

describe('realname field validation', () => {
    it('trims and collapses whitespace', () => {
        assert.deepEqual(parseRealnameFields('  张  三  ', '  第一  中学  '), {
            realName: '张 三',
            school: '第一 中学',
        });
    });

    it('rejects too-short or too-long values', () => {
        assert.throws(() => parseRealnameFields('A', 'School Name'), (e: any) => e.params?.[0] === 'realName');
        assert.throws(() => parseRealnameFields('张三', 'X'), (e: any) => e.params?.[0] === 'school');
        assert.throws(() => parseRealnameFields('张'.repeat(65), 'School Name'), (e: any) => e.params?.[0] === 'realName');
        assert.throws(() => parseRealnameFields('张三', '学'.repeat(129)), (e: any) => e.params?.[0] === 'school');
    });
});
