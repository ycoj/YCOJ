import system from '../../model/system';
import type { AiModelConfig, AiModelProfile } from './config';
import {
    AI_PROVIDER_CONFIG_KEY, getAiModelProfiles, getAiProviderConfig, resolveAiModelProfile,
} from './config';

export interface AiModelRuntimeConfig extends Omit<AiModelConfig, 'providerId' | 'providerName' | 'modelId' | 'modelName'> {
    enabled: boolean;
    profileId: string;
    providerId?: string;
    providerName?: string;
    modelId?: string;
}

export function getConfiguredAiProviderConfig() {
    return getAiProviderConfig(system.get(AI_PROVIDER_CONFIG_KEY));
}

export function getConfiguredAiModelProfiles() {
    return getAiModelProfiles(getConfiguredAiProviderConfig());
}

export function resolveConfiguredAiModelProfile(profileId: string) {
    return resolveAiModelProfile(profileId, getConfiguredAiProviderConfig());
}

export function toAiModelRuntimeConfig(profile?: AiModelProfile): AiModelRuntimeConfig {
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
    };
}

export function getAiModelRuntimeConfig(profileId: string) {
    return toAiModelRuntimeConfig(profileId ? resolveConfiguredAiModelProfile(profileId) : undefined);
}
