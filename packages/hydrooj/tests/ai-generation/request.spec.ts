import assert from 'assert';
import { describe, it } from 'node:test';
import { buildInitialPrompt } from '../../src/lib/aiGeneration/prompt';
import {
    getAiGenerationCaseLimits, getAiGenerationJudgeDefaults,
} from '../../src/lib/aiGeneration/request';

describe('AI generation request settings', () => {
    it('derives conservative testcase limits from available file slots', () => {
        assert.deepEqual(getAiGenerationCaseLimits(0, 100), {
            defaultTarget: 20,
            maxWithoutChecker: 49,
            maxWithChecker: 48,
        });
        assert.deepEqual(getAiGenerationCaseLimits(98, 100), {
            defaultTarget: 0,
            maxWithoutChecker: 0,
            maxWithChecker: 0,
        });
    });

    it('normalizes current Hydro judge limits', () => {
        assert.deepEqual(getAiGenerationJudgeDefaults({ time: '1.5s', memory: '1g' }), {
            timeLimitMs: 1500,
            memoryLimitMb: 1024,
        });
        assert.deepEqual(getAiGenerationJudgeDefaults({}), {
            timeLimitMs: 1000,
            memoryLimitMb: 256,
        });
        assert.deepEqual(getAiGenerationJudgeDefaults('time: 2s\nmemory: 128m\n'), {
            timeLimitMs: 2000,
            memoryLimitMb: 128,
        });
    });

    it('builds structured prompts without embedding supplied source code', () => {
        const prompt = buildInitialPrompt({
            profileId: 'main',
            testcaseTarget: 20,
            timeLimitMs: 1500,
            memoryLimitMb: 512,
            instructions: 'Prioritize overflow cases.',
            standardSolution: { source: 'SECRET_STANDARD_SOURCE' },
            checker: { mode: 'generated', requirements: 'Accept any valid witness.' },
        });
        assert.match(prompt, /approximately 20 test cases/);
        assert.match(prompt, /exactly 1500ms/);
        assert.match(prompt, /exactly 512m/);
        assert.match(prompt, /provided-standard-solution\.cc/);
        assert.match(prompt, /Testlib checker/);
        assert.doesNotMatch(prompt, /SECRET_STANDARD_SOURCE/);
    });
});
