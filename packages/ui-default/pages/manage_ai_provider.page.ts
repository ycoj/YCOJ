import { NamedPage } from 'vj/misc/Page';
import { i18n } from 'vj/utils';

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

interface Model {
  id: string;
  name: string;
  model: string;
  reasoning: boolean;
  thinkingLevel: ThinkingLevel;
  contextTokens: number;
  maxTokens: number;
}

interface Provider {
  id: string;
  name: string;
  apiType: 'openai-responses' | 'openai-completions';
  baseUrl: string;
  apiKey: string;
  models: Model[];
}

interface Config {
  providers: Provider[];
  dataGeneration?: { providerId: string, modelId: string };
  htmlToMarkdown?: { providerId: string, modelId: string };
}

const thinkingLevels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

function createModel(): Model {
  return {
    id: createId('model'),
    name: i18n('New model'),
    model: '',
    reasoning: true,
    thinkingLevel: 'high',
    contextTokens: 128_000,
    maxTokens: 32_000,
  };
}

function createProvider(): Provider {
  return {
    id: createId('provider'),
    name: i18n('New provider'),
    apiType: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: [createModel()],
  };
}

function formField(element: HTMLInputElement | HTMLSelectElement, label: string, className: string) {
  const column = document.createElement('div');
  column.className = className;
  const labelElement = document.createElement('label');
  labelElement.textContent = label;
  labelElement.append(element);
  column.append(labelElement);
  return column;
}

function formRow(element: HTMLInputElement | HTMLSelectElement, label: string, className = 'medium-6 columns form__item') {
  const row = document.createElement('div');
  row.className = 'row';
  row.append(formField(element, label, className));
  return row;
}

function input(
  label: string,
  current: string,
  type: string,
  change: (value: string) => void,
  compact = false,
  className?: string,
) {
  const element = document.createElement('input');
  element.className = compact ? 'textbox compact' : 'textbox';
  element.type = type;
  element.value = current;
  element.addEventListener('input', () => change(element.value));
  return className ? formField(element, label, className) : formRow(element, label);
}

function select(
  label: string,
  current: string,
  options: [string, string][],
  change: (value: string) => void,
  compact = false,
  className?: string,
) {
  const element = document.createElement('select');
  element.className = compact ? 'select compact' : 'select';
  options.forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = value === current;
    element.append(option);
  });
  element.addEventListener('change', () => change(element.value));
  return className ? formField(element, label, className) : formRow(element, label);
}

function button(text: string, click: () => void, compact = false) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = compact ? 'rounded compact button' : 'rounded button';
  element.textContent = text;
  element.addEventListener('click', click);
  return element;
}

export default new NamedPage('manage_ai_provider', () => {
  const form = document.getElementById('ai-provider-form') as HTMLFormElement;
  const value = document.getElementById('ai-provider-value') as HTMLTextAreaElement;
  const editor = document.getElementById('ai-provider-editor') as HTMLDivElement;
  const addProvider = document.getElementById('add-provider') as HTMLButtonElement;
  const config = JSON.parse(value.value) as Config;
  const state = { render: () => {} };

  function selectModel(
    key: 'dataGeneration' | 'htmlToMarkdown',
    label: string,
    fallback?: Config['dataGeneration'],
  ) {
    const options = config.providers.flatMap((provider) => provider.models.map((model) => [
      `${provider.id}:${model.id}`,
      `${provider.name} / ${model.name}`,
    ] as [string, string]));
    const selection = config[key] || fallback;
    let selected = selection && `${selection.providerId}:${selection.modelId}`;
    if (!options.some(([id]) => id === selected)) {
      const [providerId, modelId] = options[0]?.[0].split(':') || [];
      config[key] = providerId && modelId ? { providerId, modelId } : undefined;
      selected = options[0]?.[0] || '';
    } else if (!config[key] && selection) {
      config[key] = { ...selection };
    }
    return select(label, selected || '', options, (next) => {
      const [providerId, modelId] = next.split(':');
      config[key] = { providerId, modelId };
    });
  }

  function isSelected(provider: Provider, model?: Model) {
    return [config.dataGeneration, config.htmlToMarkdown].some((selection) => selection?.providerId === provider.id
      && (!model || selection.modelId === model.id));
  }

  function renderModel(provider: Provider, model: Model): HTMLElement {
    const container = document.createElement('div');
    container.className = 'ai-provider-model';
    const header = document.createElement('div');
    header.className = 'ai-provider-model__header';
    const title = document.createElement('h2');
    title.className = 'ai-provider-model__title';
    const updateTitle = () => {
      title.textContent = model.name || model.model || i18n('Model');
    };
    updateTitle();
    header.append(title, button(i18n('Remove model'), () => {
      if (isSelected(provider, model)) return;
      if (provider.models.length === 1) return;
      provider.models = provider.models.filter((item) => item !== model);
      state.render();
    }, true));
    const body = document.createElement('div');
    body.className = 'ai-provider-model__body row';
    body.append(
      input(i18n('Display name'), model.name, 'text', (next) => {
        model.name = next;
        updateTitle();
      }, true, 'medium-4 columns form__item'),
      input(i18n('API model ID'), model.model, 'text', (next) => {
        model.model = next;
        updateTitle();
      }, true, 'medium-4 columns form__item'),
      select(i18n('Reasoning support'), String(model.reasoning), [
        ['true', i18n('Supported')],
        ['false', i18n('Not supported')],
      ], (next) => { model.reasoning = next === 'true'; }, true, 'medium-4 columns form__item'),
      select(i18n('Default thinking level'), model.thinkingLevel, thinkingLevels.map((level) => [level, level]), (next) => {
        model.thinkingLevel = next as ThinkingLevel;
      }, true, 'medium-4 columns form__item'),
      input(i18n('Context window'), String(model.contextTokens), 'number', (next) => {
        model.contextTokens = Number(next);
      }, true, 'medium-4 columns form__item'),
      input(i18n('Maximum output tokens'), String(model.maxTokens), 'number', (next) => {
        model.maxTokens = Number(next);
      }, true, 'medium-4 columns form__item'),
    );
    container.append(header, body);
    return container;
  }

  function renderProvider(provider: Provider): HTMLElement {
    const section = document.createElement('div');
    section.className = 'ai-provider';
    const header = document.createElement('div');
    header.className = 'ai-provider__header';
    const title = document.createElement('h1');
    title.className = 'section__title';
    title.textContent = provider.name || i18n('Provider');
    header.append(title, button(i18n('Remove provider'), () => {
      if (isSelected(provider)) return;
      config.providers = config.providers.filter((item) => item !== provider);
      state.render();
    }));
    const body = document.createElement('div');
    body.className = 'ai-provider__body';
    body.append(
      input(i18n('Provider name'), provider.name, 'text', (next) => {
        provider.name = next;
        title.textContent = next || i18n('Provider');
      }),
      input(i18n('Base URL'), provider.baseUrl, 'url', (next) => { provider.baseUrl = next; }),
      select(i18n('API type'), provider.apiType, [
        ['openai-responses', i18n('OpenAI Responses compatible')],
        ['openai-completions', i18n('OpenAI Chat Completions compatible')],
      ], (next) => { provider.apiType = next as Provider['apiType']; }),
      input(i18n('API key'), provider.apiKey, 'password', (next) => { provider.apiKey = next; }),
      ...provider.models.map((model) => renderModel(provider, model)),
      button(i18n('Add model'), () => {
        provider.models.push(createModel());
        state.render();
      }, true),
    );
    section.append(header, body);
    return section;
  }

  state.render = () => {
    editor.replaceChildren();
    if (config.providers.length) {
      editor.append(
        selectModel('dataGeneration', i18n('AI data generation model')),
        selectModel('htmlToMarkdown', i18n('HTML to Markdown conversion model'), config.dataGeneration),
      );
    }
    config.providers.forEach((provider) => editor.append(renderProvider(provider)));
  };

  addProvider.addEventListener('click', () => {
    const provider = createProvider();
    config.providers.push(provider);
    config.dataGeneration ||= { providerId: provider.id, modelId: provider.models[0].id };
    config.htmlToMarkdown ||= { providerId: provider.id, modelId: provider.models[0].id };
    state.render();
  });
  form.addEventListener('submit', () => { value.value = JSON.stringify(config); });
  state.render();
});
