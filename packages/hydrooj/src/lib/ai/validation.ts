import type { AiModelRuntimeConfig } from './runtime';

export function validateAiModelRuntimeConfig(
    config: AiModelRuntimeConfig, disabledMessage = 'AI feature is disabled.',
) {
    if (!config.enabled) throw new Error(disabledMessage);
    if (!config.profileId.trim()) throw new Error('AI model is not configured.');
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
}
