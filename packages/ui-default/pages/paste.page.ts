import $ from 'jquery';
import Editor from 'vj/components/editor/index';
import { NamedPage } from 'vj/misc/Page';

function currentMode() {
  return String($('[name="mode"]:checked').val() || 'code');
}

function monacoLanguage() {
  if (currentMode() === 'markdown') return 'markdown';
  return String($('[name="language"]').val() || 'cpp');
}

function syncLanguageVisibility() {
  const isCode = currentMode() === 'code';
  $('.pastebin-language-field').toggle(isCode);
  $('.pastebin-language-field select').prop('disabled', !isCode);
}

export default new NamedPage(['paste_main', 'paste_edit'], () => {
  const $textarea = $('[name="content"]');
  if (!$textarea.length) return;
  const editor = Editor.getOrConstruct($textarea, {
    language: String($('[name="language"]').val() || 'cpp'),
    autoResize: false,
  }) as Editor;
  const sync = () => {
    syncLanguageVisibility();
    editor.setLanguage(monacoLanguage());
  };
  sync();
  $('[name="mode"]').on('change', sync);
  $('[name="language"]').on('change', sync);
});
