import system from '../../../model/system';
import type { PublicAiModelProfile } from '../config';
import { getSelectedAiModelProfileId } from '../config';
import {
    AiModelRuntimeConfig, getAiModelRuntimeConfig, getConfiguredAiModelProfiles,
    getConfiguredAiProviderConfig, resolveConfiguredAiModelProfile,
} from '../runtime';
import { validateAiTestdataConfig } from './validation';

export interface AiTestdataRuntimeConfig extends AiModelRuntimeConfig {
    concurrency: number;
    sandboxHost: string;
    sandboxToken?: string;
}

export function getDefaultAiTestdataProfileId() {
    const config = getConfiguredAiProviderConfig();
    return getSelectedAiModelProfileId(config?.dataGeneration, config);
}

export function resolveAiTestdataProfile(profileId: string) {
    return resolveConfiguredAiModelProfile(profileId);
}

export function getAiTestdataConfig(profileId?: string): AiTestdataRuntimeConfig {
    const selectedId = profileId || getDefaultAiTestdataProfileId();
    return {
        ...getAiModelRuntimeConfig(selectedId),
        concurrency: Math.min(32, Math.max(1, Math.trunc(+system.get('aiGeneration.concurrency') || 1))),
        sandboxHost: system.get('aiGeneration.sandboxHost') || 'http://localhost:5050',
        sandboxToken: system.get('aiGeneration.sandboxToken') || '',
    };
}

export function getPublicAiTestdataProfiles(): PublicAiModelProfile[] {
    return getConfiguredAiModelProfiles().flatMap((profile) => {
        try {
            validateAiTestdataConfig({ ...getAiTestdataConfig(profile.id), enabled: true });
            return [{ id: profile.id, label: profile.label, model: profile.model }];
        } catch {
            return [];
        }
    });
}
