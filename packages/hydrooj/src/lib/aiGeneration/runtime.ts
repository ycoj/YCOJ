import system from '../../model/system';
import type { AiAgentConfig } from './agent';
import type { AiGenerationModelProfile, PublicAiGenerationProfile } from './config';
import {
    AI_PROVIDER_CONFIG_KEY, getAiGenerationProfiles as getConfiguredProfiles,
    getAiProviderConfig, getDefaultAiGenerationProfileId as getConfiguredDefaultProfileId,
    resolveAiGenerationProfile as resolveConfiguredProfile,
} from './config';

export interface AiGenerationRuntimeConfig extends AiAgentConfig {
    enabled: boolean;
    profileId: string;
    modelId?: string;
    concurrency: number;
    sandboxHost: string;
    sandboxToken?: string;
}

function providerConfig() {
    return getAiProviderConfig(system.get(AI_PROVIDER_CONFIG_KEY));
}

export function getAiGenerationProfiles() {
    return getConfiguredProfiles(providerConfig());
}

export function getDefaultAiGenerationProfileId() {
    return getConfiguredDefaultProfileId(providerConfig());
}

export function resolveAiGenerationProfile(profileId: string) {
    return resolveConfiguredProfile(profileId, providerConfig());
}

function toRuntimeConfig(profile?: AiGenerationModelProfile): AiGenerationRuntimeConfig {
    return {
        enabled: !!system.get('aiGeneration.enabled'),
        profileId: profile?.id || '',
        apiType: profile?.apiType || 'openai-completions',
        baseUrl: profile?.baseUrl || '',
        model: profile?.model || '',
        apiKey: process.env.AI_GENERATION_API_KEY || profile?.apiKey || '',
        reasoning: profile?.reasoning !== false,
        thinkingLevel: profile?.thinkingLevel || 'high',
        contextTokens: profile?.contextTokens || 128_000,
        maxTokens: profile?.maxTokens || 32_000,
        providerId: profile?.providerId,
        providerName: profile?.providerName,
        modelId: profile?.modelId,
        concurrency: Math.min(32, Math.max(1, Math.trunc(+system.get('aiGeneration.concurrency') || 1))),
        sandboxHost: system.get('aiGeneration.sandboxHost') || 'http://localhost:5050',
        sandboxToken: system.get('aiGeneration.sandboxToken') || '',
    };
}

export function getAiGenerationConfig(profileId?: string): AiGenerationRuntimeConfig {
    const selectedId = profileId || getDefaultAiGenerationProfileId();
    return toRuntimeConfig(selectedId ? resolveAiGenerationProfile(selectedId) : undefined);
}

export function validateAiGenerationConfig(config: AiGenerationRuntimeConfig) {
    if (!config.enabled) throw new Error('AI test-data generation is disabled.');
    if (!config.profileId.trim()) throw new Error('AI generation model is not configured.');
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
    return getAiGenerationProfiles().flatMap((profile) => {
        try {
            validateAiGenerationConfig({ ...toRuntimeConfig(profile), enabled: true });
            return [{ id: profile.id, label: profile.label, model: profile.model }];
        } catch {
            return [];
        }
    });
}
