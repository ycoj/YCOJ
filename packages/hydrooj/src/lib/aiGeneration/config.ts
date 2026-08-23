import type { AiGenerationProfile } from '../../interface';
import system from '../../model/system';
import type { AiAgentConfig } from './agent';
import type { PublicAiGenerationProfile } from './profile';
import {
    createLegacyAiGenerationProfile, selectAiGenerationProfile,
    toPublicAiGenerationProfile,
} from './profile';

export interface AiGenerationRuntimeConfig extends AiAgentConfig {
    enabled: boolean;
    profileId: string;
    profileLabel: string;
    concurrency: number;
    sandboxHost: string;
    sandboxToken?: string;
}

export function getAiGenerationProfiles(): AiGenerationProfile[] {
    const profiles = system.get('aiGeneration.profiles') || [];
    return Array.isArray(profiles) && profiles.length
        ? profiles
        : [createLegacyAiGenerationProfile((key) => system.get(key as any))];
}

export function getDefaultAiGenerationProfileId(profiles = getAiGenerationProfiles()) {
    const configured = system.get('aiGeneration.defaultProfileId') || '';
    return profiles.some((profile) => profile.id === configured) ? configured : profiles[0]?.id || '';
}

export function resolveAiGenerationProfile(profileId?: string): AiGenerationProfile {
    const profiles = getAiGenerationProfiles();
    return selectAiGenerationProfile(profiles, getDefaultAiGenerationProfileId(profiles), profileId);
}

export function getAiGenerationConfig(profileId?: string): AiGenerationRuntimeConfig {
    const profile = resolveAiGenerationProfile(profileId);
    return {
        enabled: !!system.get('aiGeneration.enabled'),
        profileId: profile.id,
        profileLabel: profile.label,
        apiType: profile.apiType,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: process.env.AI_GENERATION_API_KEY || profile.apiKey || '',
        reasoning: profile.reasoning,
        thinkingLevel: profile.thinkingLevel,
        contextTokens: +profile.contextTokens || 128_000,
        maxTokens: +profile.maxTokens || 32_000,
        concurrency: Math.min(32, Math.max(1, Math.trunc(+system.get('aiGeneration.concurrency') || 1))),
        sandboxHost: system.get('aiGeneration.sandboxHost') || 'http://localhost:5050',
        sandboxToken: system.get('aiGeneration.sandboxToken') || '',
    };
}

export function validateAiGenerationConfig(config: AiGenerationRuntimeConfig) {
    if (!config.enabled) throw new Error('AI test-data generation is disabled.');
    if (!config.profileId.trim()) throw new Error('AI generation profile ID is not configured.');
    if (!config.profileLabel.trim()) throw new Error('AI generation profile label is not configured.');
    if (!['openai-completions', 'openai-responses'].includes(config.apiType)) throw new Error('Invalid AI API type.');
    if (!/^https?:\/\//.test(config.baseUrl)) throw new Error('Invalid AI API base URL.');
    if (!config.model.trim()) throw new Error('AI model is not configured.');
    if (!config.apiKey) throw new Error('AI API key is not configured.');
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(config.thinkingLevel)) {
        throw new Error('Invalid AI thinking level.');
    }
    if (!Number.isSafeInteger(config.contextTokens) || config.contextTokens < 8192 || config.contextTokens > 2_000_000) {
        throw new Error('Invalid AI context token limit.');
    }
    if (!Number.isSafeInteger(config.maxTokens)
        || config.maxTokens < 1024 || config.maxTokens > 1_000_000 || config.maxTokens > config.contextTokens) {
        throw new Error('Invalid AI maximum token limit.');
    }
    if (!/^https?:\/\//.test(config.sandboxHost)) throw new Error('Invalid go-judge Session API host.');
}

export function getPublicAiGenerationProfiles(): PublicAiGenerationProfile[] {
    const seen = new Set<string>();
    return getAiGenerationProfiles().flatMap((profile) => {
        if (!profile.id?.trim() || seen.has(profile.id)) return [];
        seen.add(profile.id);
        try {
            validateAiGenerationConfig({ ...getAiGenerationConfig(profile.id), enabled: true });
            return [toPublicAiGenerationProfile(profile)];
        } catch {
            return [];
        }
    });
}
