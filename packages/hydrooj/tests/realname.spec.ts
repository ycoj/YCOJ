import assert from 'assert';
import { describe, it } from 'node:test';
import {
    canSubmitApplication, canTransition, getRealnameStatus, handlerAllowsUnverified,
    isRealnameExempt, isRealnameVerified, nextRealnameRoute, parseRealnameFields,
    requiresRealname, reviewStatusFor, shouldBlockUnverifiedAccess,
} from '../src/lib/realname';

const PRIV_USER_PROFILE = 1 << 2;
const PRIV_CREATE_FILE = 1 << 16;
const PRIV_SEND_MESSAGE = 1 << 24;
const PRIV_JUDGE = 1 << 9;
const PRIV_ALL = -1;
const PRIV_DEFAULT = PRIV_USER_PROFILE + PRIV_CREATE_FILE + PRIV_SEND_MESSAGE;

const guest = { _id: 0, priv: 0 };
const user = { _id: 2, priv: PRIV_DEFAULT, realnameStatus: 'none' };
const pending = { ...user, realnameStatus: 'pending' };
const approved = { ...user, realnameStatus: 'approved' };
const rejected = { ...user, realnameStatus: 'rejected' };
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
        assert.equal(shouldBlockUnverifiedAccess(user, handler('Home')), true);
        assert.equal(shouldBlockUnverifiedAccess(pending, handler('ProblemMain')), true);
        assert.equal(shouldBlockUnverifiedAccess(approved, handler('Home')), false);
        assert.equal(shouldBlockUnverifiedAccess(superAdmin, handler('Home')), false);
        assert.equal(shouldBlockUnverifiedAccess(guest, handler('Home')), false);
    });

    it('allows auth, realname, and utility handlers before approval', () => {
        for (const name of [
            'UserLogin', 'UserLogout', 'UserRegister', 'HomeRealname',
            'HomeRealnameResult', 'HomeSecurity', 'Nav', 'SetTheme',
        ]) {
            assert.equal(shouldBlockUnverifiedAccess(user, handler(name)), false, name);
        }
    });

    it('honors skipRealnameCheck on unknown handlers', () => {
        assert.equal(shouldBlockUnverifiedAccess(user, handler('SomethingElse', true)), false);
        assert.equal(shouldBlockUnverifiedAccess(user, handler('SomethingElse')), true);
        assert.equal(shouldBlockUnverifiedAccess(user, handler('WebsocketEventsConnectionManager', true)), false);
        assert.equal(handlerAllowsUnverified(handler('HomeRealname')), true);
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

describe('realname field validation', () => {
    it('trims and collapses whitespace', () => {
        assert.deepEqual(parseRealnameFields('  张  三  ', '  第一  中学  '), {
            realName: '张 三',
            school: '第一 中学',
        });
    });

    it('rejects too-short or too-long values', () => {
        assert.throws(() => parseRealnameFields('A', 'School Name'), (e: any) => e.params[0] === 'realName');
        assert.throws(() => parseRealnameFields('张三', 'X'), (e: any) => e.params[0] === 'school');
        assert.throws(() => parseRealnameFields('张'.repeat(65), 'School Name'), (e: any) => e.params[0] === 'realName');
        assert.throws(() => parseRealnameFields('张三', '学'.repeat(129)), (e: any) => e.params[0] === 'school');
    });
});
