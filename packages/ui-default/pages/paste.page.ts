import $ from 'jquery';
import Editor from 'vj/components/editor/index';
import { NamedPage } from 'vj/misc/Page';

const MONACO_LANG: Record<string, string> = {
  cpp: 'cpp',
  python: 'python',
  javascript: 'javascript',
  js: 'javascript',
};

function currentMode() {
  return String($('[name="mode"]:checked').val() || 'code');
}

function currentMonacoLanguage() {
  const language = String($('[name="language"]').val() || 'cpp');
  return MONACO_LANG[language] || language || 'cpp';
}

function detachEditor($textarea: JQuery) {
  const instance = Editor.get($textarea) as Editor | undefined;
  if (!instance) {
    $textarea.show();
    return;
  }
  if (instance.isValid) {
    const value = instance.value();
    if (typeof value === 'string') $textarea.val(value);
  }
  instance.destroy();
}

function attachEditor() {
  const $textarea = $('[name="content"]');
  if (!$textarea.length) return;
  detachEditor($textarea);
  if (currentMode() === 'markdown') {
    Editor.getOrConstruct($textarea, { engine: 'markdown', language: 'markdown', autoResize: false });
    return;
  }
  Editor.getOrConstruct($textarea, {
    engine: 'monaco',
    language: currentMonacoLanguage(),
    autoResize: false,
  });
}

function syncLanguageVisibility() {
  const isCode = currentMode() === 'code';
  $('.pastebin-language-field').toggle(isCode);
  $('.pastebin-language-field select').prop('disabled', !isCode);
}

export default new NamedPage(['paste_main', 'paste_edit'], () => {
  syncLanguageVisibility();
  attachEditor();
  $('[name="mode"]').on('change', () => {
    syncLanguageVisibility();
    attachEditor();
  });
  $('[name="language"]').on('change', () => {
    if (currentMode() === 'code') attachEditor();
  });
});
