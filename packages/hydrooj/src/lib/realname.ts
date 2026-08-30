import { PRIV } from '@hydrooj/common';
import { ValidationError } from '../error';

export const REALNAME_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RealnameStatus = typeof REALNAME_STATUSES[number];
export type RealnameUserStatus = RealnameStatus | 'none';
export type RealnameReviewAction = 'approve' | 'reject' | 'revoke';

export interface RealnameUserLike {
    _id?: number;
    priv?: number;
    realnameStatus?: string;
    realName?: string;
    realnameSchool?: string;
    school?: string;
}

export type RealnameHandlerLike = { constructor?: { name?: string }, skipRealnameCheck?: boolean } & object;

const REALNAME_ALLOWED_HANDLERS = new Set([
    'UserLoginHandler',
    'UserLogoutHandler',
    'UserRegisterHandler',
    'HomeRealnameHandler',
    'HomeRealnameResultHandler',
    'HomeSecurityHandler',
    'NavHandler',
    'SetThemeHandler',
]);

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

export function nextRealnameRoute(user?: RealnameUserLike | null) {
    return getRealnameStatus(user) === 'none' ? 'home_realname' : 'home_realname_result';
}

export function handlerAllowsUnverified(handler?: RealnameHandlerLike | null) {
    return !!handler?.skipRealnameCheck || REALNAME_ALLOWED_HANDLERS.has(handler?.constructor?.name || '');
}

export function shouldBlockUnverifiedAccess(user?: RealnameUserLike | null, handler?: RealnameHandlerLike | null) {
    return requiresRealname(user) && !handlerAllowsUnverified(handler);
}

export const REALNAME_TRANSITIONS: Record<RealnameUserStatus, Partial<Record<RealnameReviewAction | 'submit', RealnameStatus>>> = {
    none: { submit: 'pending' },
    pending: { submit: 'pending', approve: 'approved', reject: 'rejected' },
    approved: { revoke: 'rejected' },
    rejected: { submit: 'pending' },
};

export function canTransition(status: RealnameUserStatus, action: RealnameReviewAction | 'submit') {
    return !!REALNAME_TRANSITIONS[status]?.[action];
}

export function canSubmitApplication(status: RealnameUserStatus) {
    return canTransition(status, 'submit');
}

export function reviewStatusFor(action: RealnameReviewAction): RealnameStatus {
    return action === 'approve' ? 'approved' : 'rejected';
}

export function normalizeRealnameField(value: string) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

export function parseRealnameFields(realName: string, school: string) {
    const name = normalizeRealnameField(realName);
    const schoolName = normalizeRealnameField(school);
    if (name.length < 2 || name.length > 64) {
        throw new ValidationError('realName');
    }
    if (schoolName.length < 2 || schoolName.length > 128) {
        throw new ValidationError('school');
    }
    return { realName: name, school: schoolName };
}
