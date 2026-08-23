import assert from 'assert';
import { describe, it } from 'node:test';
import type { AiGenerationProfile } from '../../src/interface';
import {
    createLegacyAiGenerationProfile, selectAiGenerationProfile, toPublicAiGenerationProfile,
} from '../../src/lib/aiGeneration/profile';

const profiles: AiGenerationProfile[] = [
    {
        id: 'fast',
        label: 'Fast',
        apiType: 'openai-completions',
        baseUrl: 'https://example.test/v1',
        model: 'fast-model',
        apiKey: 'fast-secret',
        reasoning: false,
        thinkingLevel: 'off',
        contextTokens: 32_000,
        maxTokens: 8_000,
    },
    {
        id: 'quality',
        label: 'Quality',
        apiType: 'openai-responses',
        baseUrl: 'https://example.test/v1',
        model: 'quality-model',
        apiKey: 'quality-secret',
        reasoning: true,
        thinkingLevel: 'high',
        contextTokens: 128_000,
        maxTokens: 32_000,
    },
];

describe('AI generation model profiles', () => {
    it('selects an explicit full profile or the configured default', () => {
        assert.equal(selectAiGenerationProfile(profiles, 'quality').id, 'quality');
        assert.equal(selectAiGenerationProfile(profiles, 'quality', 'fast').id, 'fast');
    });

    it('falls back to the first profile and rejects a removed profile', () => {
        assert.equal(selectAiGenerationProfile(profiles, 'removed').id, 'fast');
        assert.throws(
            () => selectAiGenerationProfile(profiles, 'quality', 'removed'),
            /profile not found/,
        );
    });

    it('creates the backward-compatible singleton from flat settings', () => {
        const values = {
            'aiGeneration.apiType': 'openai-responses',
            'aiGeneration.baseUrl': 'https://legacy.test/v1',
            'aiGeneration.model': 'legacy-model',
            'aiGeneration.apiKey': 'legacy-secret',
            'aiGeneration.reasoning': true,
            'aiGeneration.thinkingLevel': 'medium',
            'aiGeneration.contextTokens': 64_000,
            'aiGeneration.maxTokens': 16_000,
        };
        const profile = createLegacyAiGenerationProfile((key) => values[key]);
        assert.deepEqual(profile, {
            id: 'default',
            label: 'legacy-model',
            apiType: 'openai-responses',
            baseUrl: 'https://legacy.test/v1',
            model: 'legacy-model',
            apiKey: 'legacy-secret',
            reasoning: true,
            thinkingLevel: 'medium',
            contextTokens: 64_000,
            maxTokens: 16_000,
        });
    });

    it('projects only credential-safe profile fields', () => {
        assert.deepEqual(toPublicAiGenerationProfile(profiles[1]), {
            id: 'quality',
            label: 'Quality',
            model: 'quality-model',
        });
        assert.equal('apiKey' in toPublicAiGenerationProfile(profiles[1]), false);
        assert.equal('baseUrl' in toPublicAiGenerationProfile(profiles[1]), false);
    });
});
