import type { ProblemDoc, User } from '../../../interface';

type Permission = Parameters<User['hasPerm']>[0];

export const ACTIVE_AI_GENERATION_FILTER = {
    lang: 'ai',
    'aiGeneration.active': true,
} as const;

export function shouldCleanupAiGeneration(stage: string, hasQueuedTask: boolean) {
    return stage !== 'waiting' || !hasQueuedTask;
}

export function canGenerateTestdata(
    user: User, pdoc: ProblemDoc, selfPermission: Permission, globalPermission: Permission,
) {
    return user.own(pdoc, selfPermission) || user.hasPerm(globalPermission);
}

export function isDuplicateKeyError(error: unknown): error is { code: 11000 } {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 11000;
}

export type AiGenerationFailure = 'cancelled' | 'timeout' | 'format' | 'system';

export function classifyAiGenerationFailure(
    termination: 'cancelled' | 'timeout' | undefined,
    errorKind?: 'cancelled' | 'timeout',
    artifactValidationError = false,
): AiGenerationFailure {
    if (termination === 'cancelled' || errorKind === 'cancelled') return 'cancelled';
    if (termination === 'timeout' || errorKind === 'timeout') return 'timeout';
    return artifactValidationError ? 'format' : 'system';
}
