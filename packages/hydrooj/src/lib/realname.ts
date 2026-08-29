import { PRIV } from '@hydrooj/common';

export const REALNAME_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RealnameStatus = typeof REALNAME_STATUSES[number];
export type RealnameUserStatus = RealnameStatus | 'none';
export type RealnameReviewAction = 'approve' | 'reject' | 'revoke';

export const REALNAME_ALLOWED_HANDLERS = new Set([
    'UserLogin',
    'UserLogout',
    'UserRegister',
    'UserRegisterWithCode',
    'UserLostPass',
    'UserLostPassWithCode',
    'UserSudo',
    'UserTFA',
    'UserWebauthn',
    'Oauth',
    'OauthCallback',
    'UserChangemailWithCode',
    'HomeSecurity',
    'HomeRealname',
    'HomeRealnameResult',
    'SystemRealname',
    'SwitchLanguage',
    'SetTheme',
    'LegacyMode',
    'WikiHelp',
    'WikiAbout',
    'Nav',
    'Storage',
    'FSDownload',
    'JudgeFilesDownload',
    'JudgeFileUpdate',
    'JudgeConnection',
    'WebsocketEventsConnectionManager',
]);

export interface RealnameUserLike {
    _id?: number;
    priv?: number;
    realnameStatus?: string;
    realName?: string;
    realnameSchool?: string;
    school?: string;
}

export interface RealnameHandlerLike {
    skipRealnameCheck?: boolean;
    constructor: { name: string };
}

export function isSuperAdmin(user?: RealnameUserLike | null) {
    return !!user && user.priv === PRIV.PRIV_ALL;
}

export function isJudgeServiceAccount(user?: RealnameUserLike | null) {
    return !!user && ((user.priv || 0) & PRIV.PRIV_JUDGE) === PRIV.PRIV_JUDGE;
}

export function isLoggedIn(user?: RealnameUserLike | null) {
    return !!user && ((user.priv || 0) & PRIV.PRIV_USER_PROFILE) === PRIV.PRIV_USER_PROFILE;
}

export function getRealnameStatus(user?: RealnameUserLike | null): RealnameUserStatus {
    const status = user?.realnameStatus;
    if (status === 'pending' || status === 'approved' || status === 'rejected') return status;
    return 'none';
}

export function isRealnameExempt(user?: RealnameUserLike | null) {
    return isSuperAdmin(user) || isJudgeServiceAccount(user);
}

export function isRealnameVerified(user?: RealnameUserLike | null) {
    return isRealnameExempt(user) || getRealnameStatus(user) === 'approved';
}

export function requiresRealname(user?: RealnameUserLike | null) {
    return isLoggedIn(user) && !isRealnameVerified(user);
}

export function nextRealnameRoute(user?: RealnameUserLike | null): 'home_realname' | 'home_realname_result' {
    const status = getRealnameStatus(user);
    if (status === 'none') return 'home_realname';
    return 'home_realname_result';
}

export function handlerAllowsUnverified(handler?: RealnameHandlerLike | null) {
    if (!handler) return false;
    if (handler.skipRealnameCheck) return true;
    const name = handler.constructor.name.replace(/Handler$/, '');
    return REALNAME_ALLOWED_HANDLERS.has(name);
}

export function shouldBlockUnverifiedAccess(user?: RealnameUserLike | null, handler?: RealnameHandlerLike | null) {
    return requiresRealname(user) && !handlerAllowsUnverified(handler);
}

export function canSubmitApplication(status: RealnameUserStatus) {
    return status === 'none' || status === 'pending' || status === 'rejected';
}

export function canTransition(status: RealnameUserStatus, action: RealnameReviewAction | 'submit') {
    if (action === 'submit') return canSubmitApplication(status);
    if (action === 'approve' || action === 'reject') return status === 'pending';
    if (action === 'revoke') return status === 'approved';
    return false;
}

export function normalizeRealnameField(value: string) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

export function parseRealnameFields(realName: string, school: string) {
    const name = normalizeRealnameField(realName);
    const schoolName = normalizeRealnameField(school);
    if (name.length < 2 || name.length > 64) {
        throw Object.assign(new Error('realName'), { field: 'realName' });
    }
    if (schoolName.length < 2 || schoolName.length > 128) {
        throw Object.assign(new Error('school'), { field: 'school' });
    }
    return { realName: name, school: schoolName };
}

export function reviewStatusFor(action: RealnameReviewAction): RealnameStatus {
    if (action === 'approve') return 'approved';
    return 'rejected';
}
