import assert from 'assert';
import { describe, it } from 'node:test';
import { validateHtmlToMarkdownConfig } from '../../src/lib/ai/html2md/validation';
import type { AiModelRuntimeConfig } from '../../src/lib/ai/runtime';
import type { AiTestdataRuntimeConfig } from '../../src/lib/ai/testdata/runtime';
import { validateAiTestdataConfig } from '../../src/lib/ai/testdata/validation';
import { validateAiModelRuntimeConfig } from '../../src/lib/ai/validation';

const modelConfig: AiModelRuntimeConfig = {
    enabled: true,
    profileId: 'provider-1:model-1',
    providerId: 'provider-1',
    providerName: 'OpenAI',
    modelId: 'model-1',
    apiType: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-5',
    reasoning: true,
    thinkingLevel: 'high',
    contextTokens: 128_000,
    maxTokens: 32_000,
};

describe('AI feature runtime configuration', () => {
    it('shares provider/model validation between features', () => {
        assert.doesNotThrow(() => validateAiModelRuntimeConfig(modelConfig));
        assert.doesNotThrow(() => validateHtmlToMarkdownConfig(modelConfig));
    });

    it('keeps sandbox validation in the test-data feature', () => {
        assert.throws(
            () => validateAiTestdataConfig({
                ...modelConfig,
                concurrency: 1,
                sandboxHost: 'not-a-url',
                sandboxToken: '',
            } satisfies AiTestdataRuntimeConfig),
            /Session API host/,
        );
        assert.doesNotThrow(() => validateHtmlToMarkdownConfig(modelConfig));
    });
});
