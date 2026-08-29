import { PRIV } from '../model/builtin';
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

export type RealnameHandlerLike = { skipRealnameCheck?: boolean } & object;

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

export function shouldBlockUnverifiedAccess(user?: RealnameUserLike | null, handler?: RealnameHandlerLike | null) {
    return requiresRealname(user) && !handler?.skipRealnameCheck;
}

export const REALNAME_TRANSITIONS: Record<RealnameUserStatus, Partial<Record<RealnameReviewAction | 'submit', RealnameStatus>>> = {
    none: { submit: 'pending' },
    pending: { submit: 'pending', approve: 'approved', reject: 'rejected' },
    approved: { revoke: 'rejected' },
    rejected: { submit: 'pending' },
};

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
