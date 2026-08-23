import type { AiGenerationProfile } from '../../interface';

type LegacySettingGetter = (key: string) => any;

export interface PublicAiGenerationProfile {
    id: string;
    label: string;
    model: string;
}

export function toPublicAiGenerationProfile(profile: AiGenerationProfile): PublicAiGenerationProfile {
    return { id: profile.id, label: profile.label, model: profile.model };
}

export function createLegacyAiGenerationProfile(get: LegacySettingGetter): AiGenerationProfile {
    return {
        id: 'default',
        label: get('aiGeneration.model') || 'Default',
        apiType: get('aiGeneration.apiType') || 'openai-completions',
        baseUrl: get('aiGeneration.baseUrl') || '',
        model: get('aiGeneration.model') || '',
        apiKey: get('aiGeneration.apiKey') || '',
        reasoning: get('aiGeneration.reasoning') !== false,
        thinkingLevel: get('aiGeneration.thinkingLevel') || 'high',
        contextTokens: +get('aiGeneration.contextTokens') || 128_000,
        maxTokens: +get('aiGeneration.maxTokens') || 32_000,
    };
}

export function selectAiGenerationProfile(
    profiles: AiGenerationProfile[], configuredDefaultId: string, requestedId?: string,
) {
    const defaultId = profiles.some((profile) => profile.id === configuredDefaultId)
        ? configuredDefaultId : profiles[0]?.id || '';
    const selectedId = requestedId || defaultId;
    const profile = profiles.find((item) => item.id === selectedId);
    if (!profile) throw new Error(`AI generation profile not found: ${selectedId}`);
    return profile;
}
