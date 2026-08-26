import * as yaml from 'js-yaml';
import { parseMemoryMB, parseTimeMS } from '@hydrooj/utils';

export const DEFAULT_TESTCASE_TARGET = 20;
export const MAX_GENERATION_TEXT_LENGTH = 10_000;
export const MAX_GENERATION_SOURCE_LENGTH = 100_000;

export type AiGenerationCheckerRequest =
    | { mode: 'provided', source: string }
    | { mode: 'generated', requirements: string };

export interface AiGenerationRequest {
    profileId: string;
    testcaseTarget: number;
    timeLimitMs: number;
    memoryLimitMb: number;
    instructions: string;
    standardSolution?: { source: string };
    checker?: AiGenerationCheckerRequest;
}

export function getAiGenerationCaseLimits(additionalFileCount: number, fileLimit: number) {
    const outputSlots = Math.max(0, fileLimit - additionalFileCount - 1);
    const maxWithoutChecker = Math.max(0, Math.floor((outputSlots - 1) / 2));
    const maxWithChecker = Math.max(0, Math.floor((outputSlots - 2) / 2));
    return {
        defaultTarget: Math.min(DEFAULT_TESTCASE_TARGET, maxWithoutChecker),
        maxWithoutChecker,
        maxWithChecker,
    };
}

export function getAiGenerationJudgeDefaults(config: any) {
    let rawConfig = config;
    if (typeof config === 'string') {
        try {
            rawConfig = yaml.load(config || '{}');
        } catch {
            rawConfig = {};
        }
    }
    return {
        timeLimitMs: Math.max(1, Math.trunc(parseTimeMS(rawConfig?.time || '1s'))),
        memoryLimitMb: Math.max(1, Math.trunc(parseMemoryMB(rawConfig?.memory || '256m'))),
    };
}
