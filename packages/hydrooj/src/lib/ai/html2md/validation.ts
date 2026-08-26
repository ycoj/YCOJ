import type { AiModelRuntimeConfig } from '../runtime';
import { validateAiModelRuntimeConfig } from '../validation';

export function validateHtmlToMarkdownConfig(config: AiModelRuntimeConfig) {
    validateAiModelRuntimeConfig(config, 'AI HTML-to-Markdown conversion is disabled.');
}
