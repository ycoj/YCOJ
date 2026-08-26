import assert from 'assert';
import { describe, it } from 'node:test';
import {
    createAiProviderConfigDraft, getAiModelConfig, getAiModelProfiles, getSelectedAiModelProfileId,
    legacyAiProviderConfig, normalizeAiProviderConfig, redactAiProviderConfig, resolveAiModelProfile,
} from '../../src/lib/ai/config';

describe('AI provider configuration', () => {
    it('resolves the selected model without exposing its key to rendered configuration', () => {
        const config = createAiProviderConfigDraft();
        config.providers[0].apiKey = 'test-key';
        const resolved = getAiModelConfig(config.dataGeneration, config);
        assert.equal(resolved?.apiType, 'openai-responses');
        assert.equal(resolved?.model, 'gpt-5');
        assert.equal(resolved?.apiKey, 'test-key');
        assert.equal(getSelectedAiModelProfileId(config.htmlToMarkdown, config), 'provider-1:model-1');
        assert.equal(redactAiProviderConfig(config)?.providers[0].apiKey, '');
    });

    it('supports a separate HTML-to-Markdown model and migrates older configurations', () => {
        const config = createAiProviderConfigDraft();
        config.providers[0].apiKey = 'test-key';
        config.providers[0].models.push({
            ...config.providers[0].models[0],
            id: 'model-2',
            name: 'Conversion model',
            model: 'conversion-model',
        });
        config.htmlToMarkdown = { providerId: 'provider-1', modelId: 'model-2' };
        const normalized = normalizeAiProviderConfig(config);
        assert.equal(getSelectedAiModelProfileId(normalized.htmlToMarkdown, normalized), 'provider-1:model-2');

        delete config.htmlToMarkdown;
        const migrated = normalizeAiProviderConfig(config);
        assert.deepEqual(migrated.htmlToMarkdown, migrated.dataGeneration);

        const submitted = redactAiProviderConfig(migrated)!;
        delete submitted.htmlToMarkdown;
        const existing = { ...migrated, htmlToMarkdown: { providerId: 'provider-1', modelId: 'model-2' } };
        assert.deepEqual(normalizeAiProviderConfig(submitted, existing).htmlToMarkdown, existing.htmlToMarkdown);
    });

    it('exposes only configured provider models as selectable profiles', () => {
        const config = createAiProviderConfigDraft();
        config.providers[0].apiKey = 'test-key';
        config.providers[0].models.push({
            ...config.providers[0].models[0],
            id: 'model-2',
            name: 'GPT-5 mini',
            model: 'gpt-5-mini',
        });
        assert.deepEqual(
            getAiModelProfiles(config).map(({ id, label, model }) => ({ id, label, model })),
            [
                { id: 'provider-1:model-1', label: 'OpenAI / GPT-5', model: 'gpt-5' },
                { id: 'provider-1:model-2', label: 'OpenAI / GPT-5 mini', model: 'gpt-5-mini' },
            ],
        );
        assert.equal(resolveAiModelProfile('provider-1:model-2', config).model, 'gpt-5-mini');
        assert.throws(
            () => resolveAiModelProfile('provider-1:unconfigured', config),
            /profile not found/,
        );
    });

    it('preserves a stored key when an existing provider is saved with an empty key', () => {
        const existing = createAiProviderConfigDraft();
        existing.providers[0].apiKey = 'stored-key';
        const submitted = redactAiProviderConfig(existing)!;
        const result = normalizeAiProviderConfig(submitted, existing);
        assert.equal(result.providers[0].apiKey, 'stored-key');
    });

    it('rejects invalid assignments and token limits', () => {
        const config = createAiProviderConfigDraft();
        config.providers[0].apiKey = 'test-key';
        config.dataGeneration!.modelId = 'missing';
        assert.throws(() => normalizeAiProviderConfig(config), /dataGeneration/);
        config.dataGeneration!.modelId = 'model-1';
        config.htmlToMarkdown!.modelId = 'missing';
        assert.throws(() => normalizeAiProviderConfig(config), /htmlToMarkdown/);
        config.htmlToMarkdown!.modelId = 'model-1';
        (config as any).htmlToMarkdown = null;
        assert.throws(() => normalizeAiProviderConfig(config), /htmlToMarkdown/);
        config.htmlToMarkdown = { providerId: 'provider-1', modelId: 'model-1' };
        config.providers[0].models[0].maxTokens = 200_000;
        config.providers[0].models[0].contextTokens = 128_000;
        assert.throws(() => normalizeAiProviderConfig(config), /maxTokens/);
    });

    it('converts legacy settings to an OpenAI-compatible provider profile', () => {
        const config = legacyAiProviderConfig({
            'aiGeneration.apiType': 'openai-completions',
            'aiGeneration.baseUrl': 'https://example.test/v1/',
            'aiGeneration.apiKey': 'legacy-key',
            'aiGeneration.model': 'legacy-model',
            'aiGeneration.reasoning': false,
            'aiGeneration.thinkingLevel': 'low',
            'aiGeneration.contextTokens': 16_000,
            'aiGeneration.maxTokens': 4_000,
        });
        const resolved = getAiModelConfig(config.dataGeneration, config);
        assert.equal(resolved?.baseUrl, 'https://example.test/v1');
        assert.equal(resolved?.model, 'legacy-model');
        assert.equal(resolved?.reasoning, false);
    });
});
