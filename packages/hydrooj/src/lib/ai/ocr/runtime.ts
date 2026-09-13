import { getSelectedAiModelProfileId } from '../config';
import {
    AiModelRuntimeConfig, getAiModelRuntimeConfig, getConfiguredAiProviderConfig,
} from '../runtime';

export function getMarkdownOcrConfig(profileId?: string): AiModelRuntimeConfig {
    const providerConfig = getConfiguredAiProviderConfig();
    const selectedId = profileId || getSelectedAiModelProfileId(
        providerConfig?.markdownOcr || providerConfig?.htmlToMarkdown || providerConfig?.dataGeneration,
        providerConfig,
    );
    return getAiModelRuntimeConfig(selectedId);
}
