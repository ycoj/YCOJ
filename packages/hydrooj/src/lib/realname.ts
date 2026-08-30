import { PRIV } from '@hydrooj/common';
import { AwardNotBoundError, ValidationError } from '../error';

export const REALNAME_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RealnameStatus = typeof REALNAME_STATUSES[number];
export type RealnameUserStatus = RealnameStatus | 'none';
export type RealnameReviewAction = 'approve' | 'reject' | 'revoke';

export const REALNAME_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface RealnameUserLike {
    _id?: number;
    priv?: number;
    realnameStatus?: string;
    realName?: string;
    realnameSchool?: string;
    school?: string;
    realnameSubmittedAt?: Date | string | number | null;
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

export function asDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

export function getRealnameSubmittedAt(
    user?: RealnameUserLike | null,
    fallbackSubmittedAt?: Date | string | number | null,
): Date | null {
    return asDate(user?.realnameSubmittedAt) ?? asDate(fallbackSubmittedAt);
}

export function getRealnameGraceUntil(
    user?: RealnameUserLike | null,
    fallbackSubmittedAt?: Date | string | number | null,
): Date | null {
    const submittedAt = getRealnameSubmittedAt(user, fallbackSubmittedAt);
    if (!submittedAt) return null;
    return new Date(submittedAt.getTime() + REALNAME_GRACE_MS);
}

export function isWithinRealnameGrace(
    user?: RealnameUserLike | null,
    now: Date = new Date(),
    fallbackSubmittedAt?: Date | string | number | null,
) {
    const status = getRealnameStatus(user);
    if (status !== 'pending' && status !== 'rejected') return false;
    const graceUntil = getRealnameGraceUntil(user, fallbackSubmittedAt);
    return !!graceUntil && now.getTime() < graceUntil.getTime();
}

export function isRealnameExempt(user?: RealnameUserLike | null) {
    return isSuperAdmin(user) || isJudgeServiceAccount(user);
}

export function isRealnameVerified(user?: RealnameUserLike | null) {
    return isRealnameExempt(user) || getRealnameStatus(user) === 'approved';
}

export function hasRealnameAccess(user?: RealnameUserLike | null, now: Date = new Date()) {
    return isRealnameVerified(user) || isWithinRealnameGrace(user, now);
}

export function requiresRealname(user?: RealnameUserLike | null) {
    return isLoggedIn(user) && !isRealnameVerified(user);
}

export function handlerAllowsUnverified(handler?: RealnameHandlerLike | null) {
    return !!handler?.skipRealnameCheck;
}

export function shouldBlockUnverifiedAccess(
    user?: RealnameUserLike | null,
    handler?: RealnameHandlerLike | null,
    now: Date = new Date(),
) {
    return isLoggedIn(user) && !hasRealnameAccess(user, now) && !handlerAllowsUnverified(handler);
}

export function nextRealnameRoute(user?: RealnameUserLike | null) {
    return getRealnameStatus(user) === 'none' ? 'home_realname' : 'home_realname_result';
}

export const REALNAME_TRANSITIONS: Record<RealnameUserStatus, Partial<Record<RealnameReviewAction | 'submit', RealnameStatus>>> = {
    none: { submit: 'pending' },
    pending: { submit: 'pending', approve: 'approved', reject: 'rejected' },
    approved: { revoke: 'rejected' },
    rejected: { submit: 'pending' },
};

export function canTransition(status: RealnameUserStatus, action: RealnameReviewAction | 'submit') {
    return !!REALNAME_TRANSITIONS[status][action];
}

export function canSubmitApplication(status: RealnameUserStatus) {
    return canTransition(status, 'submit');
}

export function reviewStatusFor(action: RealnameReviewAction): RealnameStatus {
    switch (action) {
        case 'approve': return 'approved';
        case 'reject': return 'rejected';
        case 'revoke': return 'rejected';
        default: {
            const exhaustive: never = action;
            return exhaustive;
        }
    }
}

export function normalizeRealnameField(value: string) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

export function buildLatestRealnameListPipeline(
    filter: { uid?: unknown; status?: RealnameStatus },
    page: number,
    pageSize: number,
) {
    const pipeline: Record<string, unknown>[] = [];
    if (filter.uid !== undefined) pipeline.push({ $match: { uid: filter.uid } });
    pipeline.push(
        {
            $group: {
                _id: '$uid',
                doc: {
                    $top: {
                        sortBy: { submittedAt: -1, _id: -1 },
                        output: '$$ROOT',
                    },
                },
            },
        },
        { $replaceRoot: { newRoot: '$doc' } },
    );
    if (filter.status) pipeline.push({ $match: { status: filter.status } });
    pipeline.push(
        { $sort: { submittedAt: -1, _id: -1 } },
        {
            $facet: {
                count: [{ $count: 'n' }],
                docs: [
                    { $skip: (page - 1) * pageSize },
                    { $limit: pageSize },
                ],
            },
        },
    );
    return pipeline;
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

export async function unbindAwardsOrRollback(
    uid: number,
    rollback: () => Promise<void>,
    unbindByUid: (uid: number) => Promise<unknown>,
) {
    try {
        await unbindByUid(uid);
    } catch (e) {
        if (e instanceof AwardNotBoundError) return;
        await rollback();
        throw e;
    }
}
