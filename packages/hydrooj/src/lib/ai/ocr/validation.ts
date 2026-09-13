import type { AiModelRuntimeConfig } from '../runtime';
import { validateAiModelRuntimeConfig } from '../validation';

export function validateMarkdownOcrConfig(config: AiModelRuntimeConfig) {
    validateAiModelRuntimeConfig(config, 'AI Markdown OCR is disabled.');
}
