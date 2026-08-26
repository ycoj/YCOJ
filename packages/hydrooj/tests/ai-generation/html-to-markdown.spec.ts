import assert from 'assert';
import { describe, it } from 'node:test';
import {
    convertHtmlToMarkdown, HTML_TO_MARKDOWN_SYSTEM_PROMPT, MAX_HTML_TO_MARKDOWN_LENGTH,
} from '../../src/lib/ai/html2md/converter';

describe('HTML to Markdown conversion', () => {
    it('states the problem Markdown rules in the system prompt', () => {
        assert.match(HTML_TO_MARKDOWN_SYSTEM_PROMPT, /Task background/);
        assert.match(HTML_TO_MARKDOWN_SYSTEM_PROMPT, /LaTeX/);
        assert.match(HTML_TO_MARKDOWN_SYSTEM_PROMPT, /```input\{x\}/);
        assert.match(HTML_TO_MARKDOWN_SYSTEM_PROMPT, /```output\{x\}/);
        assert.match(HTML_TO_MARKDOWN_SYSTEM_PROMPT, /Output only the final Markdown/);
    });

    it('rejects HTML exceeding the request limit before contacting the provider', async () => {
        await assert.rejects(
            convertHtmlToMarkdown({} as any, 'x'.repeat(MAX_HTML_TO_MARKDOWN_LENGTH + 1)),
            /exceeds 200000 characters/,
        );
    });
});
