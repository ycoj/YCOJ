import { nanoid } from 'nanoid';

export const AI_PROVIDER_CONFIG_KEY = 'ai.providerConfig';
export const LEGACY_AI_PROVIDER_KEYS = [
    'aiGeneration.apiType', 'aiGeneration.baseUrl', 'aiGeneration.model', 'aiGeneration.apiKey',
    'aiGeneration.reasoning', 'aiGeneration.thinkingLevel', 'aiGeneration.contextTokens', 'aiGeneration.maxTokens',
] as const;

export type AiApiType = 'openai-completions' | 'openai-responses';
export type AiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const API_TYPES: AiApiType[] = ['openai-completions', 'openai-responses'];
const THINKING_LEVELS: AiThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface AiProviderModel {
    id: string;
    name: string;
    model: string;
    reasoning: boolean;
    thinkingLevel: AiThinkingLevel;
    contextTokens: number;
    maxTokens: number;
}

export interface AiProvider {
    id: string;
    name: string;
    apiType: AiApiType;
    baseUrl: string;
    apiKey: string;
    models: AiProviderModel[];
}

export interface AiModelSelection {
    providerId: string;
    modelId: string;
}

export interface AiProviderConfig {
    version: 1;
    providers: AiProvider[];
    dataGeneration?: AiModelSelection;
    htmlToMarkdown?: AiModelSelection;
}

export interface AiModelConfig {
    providerId: string;
    providerName: string;
    modelId: string;
    modelName: string;
    apiType: AiApiType;
    baseUrl: string;
    apiKey: string;
    model: string;
    reasoning: boolean;
    thinkingLevel: AiThinkingLevel;
    contextTokens: number;
    maxTokens: number;
}

export function createAiProviderConfigDraft(): AiProviderConfig {
    const providerId = 'provider-1';
    const modelId = 'model-1';
    return {
        version: 1,
        providers: [{
            id: providerId,
            name: 'OpenAI',
            apiType: 'openai-responses',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            models: [{
                id: modelId,
                name: 'GPT-5',
                model: 'gpt-5',
                reasoning: true,
                thinkingLevel: 'high',
                contextTokens: 128_000,
                maxTokens: 32_000,
            }],
        }],
        dataGeneration: { providerId, modelId },
        htmlToMarkdown: { providerId, modelId },
    };
}

function isObject(value: any): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: any, key: string) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid AI provider configuration: ${key}.`);
    return value.trim();
}

function id(value: any, key: string) {
    const result = requiredString(value, key);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(result)) throw new Error(`Invalid AI provider configuration: ${key}.`);
    return result;
}

function tokenLimit(value: any, key: string, min: number, max: number) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`Invalid AI provider configuration: ${key}.`);
    }
    return value;
}

function normalizeModel(value: any, providerId: string, existing?: AiProviderModel): AiProviderModel {
    if (!isObject(value)) throw new Error('Invalid AI provider configuration: model.');
    const modelId = value.id || existing?.id || nanoid(12);
    const contextTokens = tokenLimit(value.contextTokens, `providers.${providerId}.models.${modelId}.contextTokens`, 8192, 2_000_000);
    const maxTokens = tokenLimit(value.maxTokens, `providers.${providerId}.models.${modelId}.maxTokens`, 1024, 1_000_000);
    if (maxTokens > contextTokens) throw new Error(`Invalid AI provider configuration: providers.${providerId}.models.${modelId}.maxTokens.`);
    if (!THINKING_LEVELS.includes(value.thinkingLevel)) {
        throw new Error(`Invalid AI provider configuration: providers.${providerId}.models.${modelId}.thinkingLevel.`);
    }
    if (typeof value.reasoning !== 'boolean') {
        throw new TypeError(`Invalid AI provider configuration: providers.${providerId}.models.${modelId}.reasoning.`);
    }
    return {
        id: id(modelId, 'model.id'),
        name: requiredString(value.name, 'model.name'),
        model: requiredString(value.model, 'model.model'),
        reasoning: value.reasoning,
        thinkingLevel: value.thinkingLevel,
        contextTokens,
        maxTokens,
    };
}

function normalizeProvider(value: any, existing?: AiProvider): AiProvider {
    if (!isObject(value)) throw new Error('Invalid AI provider configuration: provider.');
    const providerId = id(value.id || existing?.id || nanoid(12), 'provider.id');
    if (!API_TYPES.includes(value.apiType)) throw new Error(`Invalid AI provider configuration: providers.${providerId}.apiType.`);
    const baseUrl = requiredString(value.baseUrl, `providers.${providerId}.baseUrl`);
    if (!/^https?:\/\//.test(baseUrl)) throw new Error(`Invalid AI provider configuration: providers.${providerId}.baseUrl.`);
    if (!Array.isArray(value.models) || !value.models.length) throw new Error(`Invalid AI provider configuration: providers.${providerId}.models.`);
    const existingModels = new Map((existing?.models || []).map((model) => [model.id, model]));
    const models = value.models.map((model) => normalizeModel(model, providerId, existingModels.get(model?.id)));
    if (new Set(models.map((model) => model.id)).size !== models.length) {
        throw new Error(`Invalid AI provider configuration: providers.${providerId}.models.`);
    }
    const apiKey = typeof value.apiKey === 'string' && value.apiKey ? value.apiKey : existing?.apiKey || '';
    if (!apiKey && !existing) throw new Error(`Invalid AI provider configuration: providers.${providerId}.apiKey.`);
    return {
        id: providerId,
        name: requiredString(value.name, `providers.${providerId}.name`),
        apiType: value.apiType,
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiKey,
        models,
    };
}

export function normalizeAiProviderConfig(value: any, existing?: AiProviderConfig): AiProviderConfig {
    if (!isObject(value) || value.version !== 1 || !Array.isArray(value.providers)) {
        throw new Error('Invalid AI provider configuration.');
    }
    const existingProviders = new Map((existing?.providers || []).map((provider) => [provider.id, provider]));
    const providers = value.providers.map((provider) => normalizeProvider(provider, existingProviders.get(provider?.id)));
    if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
        throw new Error('Invalid AI provider configuration: duplicate provider ID.');
    }
    const normalizeAssignment = (assignment: any, key: string) => {
        if (!isObject(assignment)) throw new Error(`Invalid AI provider configuration: ${key}.`);
        const provider = providers.find((item) => item.id === assignment.providerId);
        const model = provider?.models.find((item) => item.id === assignment.modelId);
        if (!provider || !model) throw new Error(`Invalid AI provider configuration: ${key}.`);
        return { providerId: provider.id, modelId: model.id };
    };
    const dataGeneration = normalizeAssignment(value.dataGeneration, 'dataGeneration');
    // Configurations saved before the dedicated conversion model was introduced use the data-generation model.
    const htmlToMarkdownValue = Object.hasOwn(value, 'htmlToMarkdown')
        ? value.htmlToMarkdown
        : existing?.htmlToMarkdown || dataGeneration;
    const htmlToMarkdown = normalizeAssignment(htmlToMarkdownValue, 'htmlToMarkdown');
    return { version: 1, providers, dataGeneration, htmlToMarkdown };
}

export function getAiProviderConfig(value: any): AiProviderConfig | undefined {
    try {
        return value ? normalizeAiProviderConfig(value, value) : undefined;
    } catch {
        return undefined;
    }
}

export function getAiModelConfig(
    selection: AiModelSelection | undefined, config?: AiProviderConfig,
): AiModelConfig | undefined {
    const provider = config?.providers.find((item) => item.id === selection?.providerId);
    const model = provider?.models.find((item) => item.id === selection?.modelId);
    if (!provider || !model) return undefined;
    return {
        providerId: provider.id, providerName: provider.name, modelId: model.id, modelName: model.name,
        apiType: provider.apiType, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: model.model,
        reasoning: model.reasoning, thinkingLevel: model.thinkingLevel,
        contextTokens: model.contextTokens, maxTokens: model.maxTokens,
    };
}

export function getAiModelConfigByIds(
    providerId: string, modelId: string, config?: AiProviderConfig,
) {
    return getAiModelConfig({ providerId, modelId }, config);
}

export function redactAiProviderConfig(config?: AiProviderConfig) {
    if (!config) return undefined;
    return {
        ...config,
        providers: config.providers.map((provider) => ({ ...provider, apiKey: '' })),
    };
}

export function legacyAiProviderConfig(values: Record<string, any>): AiProviderConfig {
    const providerId = 'legacy-openai';
    const modelId = 'legacy-model';
    const config: AiProviderConfig = {
        version: 1,
        providers: [{
            id: providerId, name: 'Migrated AI provider',
            apiType: values['aiGeneration.apiType'] === 'openai-responses' ? 'openai-responses' : 'openai-completions',
            baseUrl: values['aiGeneration.baseUrl'] || 'https://api.openai.com/v1',
            apiKey: values['aiGeneration.apiKey'] || '',
            models: [{
                id: modelId, name: values['aiGeneration.model'] || 'gpt-5', model: values['aiGeneration.model'] || 'gpt-5',
                reasoning: values['aiGeneration.reasoning'] !== false,
                thinkingLevel: THINKING_LEVELS.includes(values['aiGeneration.thinkingLevel']) ? values['aiGeneration.thinkingLevel'] : 'high',
                contextTokens: Number.isSafeInteger(values['aiGeneration.contextTokens']) ? values['aiGeneration.contextTokens'] : 128_000,
                maxTokens: Number.isSafeInteger(values['aiGeneration.maxTokens']) ? values['aiGeneration.maxTokens'] : 32_000,
            }],
        }],
        dataGeneration: { providerId, modelId },
    };
    return normalizeAiProviderConfig(config, config);
}

export interface PublicAiModelProfile {
    id: string;
    label: string;
    model: string;
}

export interface AiModelProfile extends AiModelConfig {
    id: string;
    label: string;
}

export function getAiModelProfileId(providerId: string, modelId: string) {
    return `${providerId}:${modelId}`;
}

export function getAiModelProfiles(config?: AiProviderConfig): AiModelProfile[] {
    return (config?.providers || []).flatMap((provider) => provider.models.map((model) => ({
        ...getAiModelConfigByIds(provider.id, model.id, config)!,
        id: getAiModelProfileId(provider.id, model.id),
        label: `${provider.name} / ${model.name}`,
    })));
}

export function getSelectedAiModelProfileId(
    selection: AiModelSelection | undefined, config?: AiProviderConfig,
) {
    if (!selection) return '';
    const profileId = getAiModelProfileId(selection.providerId, selection.modelId);
    return getAiModelProfiles(config).some((profile) => profile.id === profileId) ? profileId : '';
}

export function resolveAiModelProfile(
    profileId: string, config?: AiProviderConfig,
): AiModelProfile {
    const profile = getAiModelProfiles(config).find((item) => item.id === profileId);
    if (!profile) throw new Error(`AI model profile not found: ${profileId}`);
    return profile;
}
