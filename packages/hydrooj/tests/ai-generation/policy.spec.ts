import assert from 'assert';
import { describe, it } from 'node:test';
import {
    ACTIVE_AI_GENERATION_FILTER, canGenerateTestdata, classifyAiGenerationFailure,
    isDuplicateKeyError, shouldCleanupAiGeneration,
} from '../../src/lib/aiGeneration/policy';

describe('AI generation policy', () => {
    it('allows self-edit or global problem-edit permission', () => {
        const pdoc = {} as any;
        const selfPermission = 1n;
        const globalPermission = 2n;
        const user = (self: boolean, global: boolean) => ({
            own: (_doc, permission) => self && permission === selfPermission,
            hasPerm: (permission) => global && permission === globalPermission,
        }) as any;
        assert.equal(canGenerateTestdata(user(true, false), pdoc, selfPermission, globalPermission), true);
        assert.equal(canGenerateTestdata(user(false, true), pdoc, selfPermission, globalPermission), true);
        assert.equal(canGenerateTestdata(user(false, false), pdoc, selfPermission, globalPermission), false);
    });

    it('recognizes the database constraint used as the single-problem lock', () => {
        assert.equal(isDuplicateKeyError({ code: 11000 }), true);
        assert.equal(isDuplicateKeyError({ code: 13 }), false);
        assert.equal(isDuplicateKeyError(null), false);
    });

    it('classifies cancellation, total timeout, format, and system failures', () => {
        assert.equal(classifyAiGenerationFailure('cancelled'), 'cancelled');
        assert.equal(classifyAiGenerationFailure(undefined, 'cancelled'), 'cancelled');
        assert.equal(classifyAiGenerationFailure('timeout'), 'timeout');
        assert.equal(classifyAiGenerationFailure(undefined, 'timeout'), 'timeout');
        assert.equal(classifyAiGenerationFailure(undefined, undefined, true), 'format');
        assert.equal(classifyAiGenerationFailure(undefined), 'system');
    });

    it('keeps queued work recoverable but cleans started or orphaned waiting work on restart', () => {
        assert.deepEqual(ACTIVE_AI_GENERATION_FILTER, {
            lang: 'ai',
            'aiGeneration.active': true,
        });
        assert.equal(shouldCleanupAiGeneration('waiting', true), false);
        assert.equal(shouldCleanupAiGeneration('waiting', false), true);
        assert.equal(shouldCleanupAiGeneration('agent', false), true);
    });
});
