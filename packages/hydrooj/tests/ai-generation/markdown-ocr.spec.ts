import assert from 'assert';
import { describe, it } from 'node:test';

function mockModule(request: string, exports: unknown) {
    require.cache[require.resolve(request)] = { exports } as NodeJS.Module;
}

let lastGenerateText: any;
let generated = 0;
let generateTextImpl: (options: any) => Promise<any> = async (options) => {
    lastGenerateText = options;
    generated += 1;
    return { text: `page ${generated}` };
};
mockModule('ai', { generateText: (options: any) => generateTextImpl(options) });
mockModule('@ai-sdk/openai', {
    createOpenAI: () => ({
        responses: (model: string) => ({ api: 'responses', model }),
        chat: (model: string) => ({ api: 'chat', model }),
    }),
});

// pdf-to-img is ESM-only and loaded through a dynamic import, so require.cache mocks cannot reach
// it; convertPdfToMarkdown/convertFileToMarkdown accept an injectable loadPdf seam instead. Each
// call materializes a preconfigured async-iterable page document so conversion order, page count,
// and teardown can be asserted without the native canvas dependency doing real work.
let nextPdf: { length: number, pages: Buffer[] } | null = null;
const pdfDocuments: any[] = [];
const loadPdf = async () => ({
    pdf: async () => {
        const document = {
            length: nextPdf?.length ?? 0,
            pages: nextPdf?.pages ?? [],
            destroyed: false,
            async *[Symbol.asyncIterator]() { for (const page of this.pages) yield page; },
            async destroy() { this.destroyed = true; },
        };
        pdfDocuments.push(document);
        return document;
    },
});

const {
    convertFileToMarkdown, convertImageToMarkdown, convertPdfToMarkdown,
    detectMarkdownOcrFileType, MARKDOWN_OCR_SYSTEM_PROMPT,
    MAX_MARKDOWN_OCR_PAGES,
} = require('../../src/lib/ai/ocr/converter');

const config: any = {
    enabled: true,
    profileId: 'p:m',
    apiType: 'openai-completions',
    baseUrl: 'https://api.test/v1',
    model: 'vision-model',
    apiKey: 'secret',
    maxTokens: 32_000,
};

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
const GIF = Buffer.from('GIF89axxxxx');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]);
const PDF = Buffer.from('%PDF-1.7 fake');

describe('Markdown OCR conversion', () => {
    it('states the problem Markdown rules in the system prompt', () => {
        assert.match(MARKDOWN_OCR_SYSTEM_PROMPT, /Task background/);
        assert.match(MARKDOWN_OCR_SYSTEM_PROMPT, /\$\.\.\.\$/);
        assert.match(MARKDOWN_OCR_SYSTEM_PROMPT, /\$\$\.\.\.\$\$/);
        assert.match(MARKDOWN_OCR_SYSTEM_PROMPT, /```input\{x\}/);
        assert.match(MARKDOWN_OCR_SYSTEM_PROMPT, /```output\{x\}/);
        assert.match(MARKDOWN_OCR_SYSTEM_PROMPT, /Output only the final Markdown/);
    });

    it('detects image types by magic bytes before trusting client hints', () => {
        assert.deepEqual(detectMarkdownOcrFileType(PNG, 'application/octet-stream', 'a.bin'),
            { kind: 'image', mediaType: 'image/png' });
        assert.deepEqual(detectMarkdownOcrFileType(JPEG, null, null), { kind: 'image', mediaType: 'image/jpeg' });
        assert.deepEqual(detectMarkdownOcrFileType(GIF, '', ''), { kind: 'image', mediaType: 'image/gif' });
        assert.deepEqual(detectMarkdownOcrFileType(WEBP, '', ''), { kind: 'image', mediaType: 'image/webp' });
    });

    it('detects PDFs by header, mimetype, or extension', () => {
        assert.deepEqual(detectMarkdownOcrFileType(PDF, '', ''), { kind: 'pdf', mediaType: 'application/pdf' });
        assert.deepEqual(detectMarkdownOcrFileType(PNG, 'application/pdf', 'x'), { kind: 'pdf', mediaType: 'application/pdf' });
        assert.deepEqual(detectMarkdownOcrFileType(PNG, '', 'scan.PDF'), { kind: 'pdf', mediaType: 'application/pdf' });
    });

    it('falls back to declared mimetype or extension and rejects unknown files', () => {
        assert.deepEqual(detectMarkdownOcrFileType(Buffer.from('x'), 'image/jpeg', 'a'),
            { kind: 'image', mediaType: 'image/jpeg' });
        assert.deepEqual(detectMarkdownOcrFileType(Buffer.from('x'), '', 'a.JPG'),
            { kind: 'image', mediaType: 'image/jpeg' });
        assert.equal(detectMarkdownOcrFileType(Buffer.from('x'), 'text/plain', 'a.txt'), null);
        assert.equal(detectMarkdownOcrFileType(Buffer.from('x'), '', ''), null);
    });

    it('sends the image as a file content part with the system prompt and limits', async () => {
        generated = 0;
        const controller = new AbortController();
        const markdown = await convertImageToMarkdown(config, PNG, 'image/png', controller.signal);
        assert.equal(markdown, 'page 1');
        assert.equal(lastGenerateText.system, MARKDOWN_OCR_SYSTEM_PROMPT);
        assert.equal(lastGenerateText.maxOutputTokens, 32_000);
        assert.equal(lastGenerateText.abortSignal, controller.signal);
        const [text, file] = lastGenerateText.messages[0].content;
        assert.equal(text.type, 'text');
        assert.deepEqual({ type: file.type, mediaType: file.mediaType, data: file.data },
            { type: 'file', mediaType: 'image/png', data: PNG });
        assert.deepEqual(lastGenerateText.model, { api: 'chat', model: 'vision-model' });
    });

    it('uses the responses API when configured', async () => {
        await convertImageToMarkdown({ ...config, apiType: 'openai-responses' }, PNG, 'image/png');
        assert.deepEqual(lastGenerateText.model, { api: 'responses', model: 'vision-model' });
    });

    it('rejects empty model output', async () => {
        generateTextImpl = async () => ({ text: '   ' });
        await assert.rejects(convertImageToMarkdown(config, PNG, 'image/png'), /empty Markdown/);
        generateTextImpl = async (options: any) => {
            lastGenerateText = options;
            generated += 1;
            return { text: `page ${generated}` };
        };
    });

    it('rejects PDFs over the page limit before rendering pages', async () => {
        pdfDocuments.length = 0;
        nextPdf = { length: MAX_MARKDOWN_OCR_PAGES + 1, pages: [] };
        await assert.rejects(convertPdfToMarkdown(config, PDF, undefined, undefined, loadPdf), /the limit is/);
        assert.equal(pdfDocuments[0].destroyed, true);
    });

    it('converts each PDF page in order, reports progress, and joins the Markdown', async () => {
        generated = 0;
        pdfDocuments.length = 0;
        nextPdf = { length: 3, pages: [Buffer.from('p1'), Buffer.from('p2'), Buffer.from('p3')] };
        const instructions: string[] = [];
        generateTextImpl = async (options: any) => {
            instructions.push(options.messages[0].content[0].text);
            return { text: `page ${instructions.length}` };
        };
        const progress: [number, number][] = [];
        const result = await convertPdfToMarkdown(
            config, PDF, (done, total) => { progress.push([done, total]); }, undefined, loadPdf,
        );
        assert.equal(result.pages, 3);
        assert.equal(result.markdown, 'page 1\n\npage 2\n\npage 3');
        assert.match(instructions[0], /page 1 of 3/);
        assert.match(instructions[2], /page 3 of 3/);
        assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
        assert.equal(pdfDocuments[0].destroyed, true);
        generateTextImpl = async (options: any) => {
            lastGenerateText = options;
            generated += 1;
            return { text: `page ${generated}` };
        };
    });

    it('rejects a PDF that produces no pages and honors an aborted signal', async () => {
        pdfDocuments.length = 0;
        nextPdf = { length: 0, pages: [] };
        await assert.rejects(convertPdfToMarkdown(config, PDF, undefined, undefined, loadPdf), /empty Markdown/);
        nextPdf = { length: 1, pages: [Buffer.from('p1')] };
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(convertPdfToMarkdown(config, PDF, undefined, controller.signal, loadPdf));
    });

    it('dispatches images and PDFs through convertFileToMarkdown', async () => {
        nextPdf = { length: 2, pages: [Buffer.from('p1'), Buffer.from('p2')] };
        const pdfResult = await convertFileToMarkdown(
            config, { data: PDF, kind: 'pdf', mediaType: 'application/pdf' }, undefined, undefined, loadPdf,
        );
        assert.equal(pdfResult.pages, 2);
        const progress: [number, number][] = [];
        const imageResult = await convertFileToMarkdown(
            config, { data: PNG, kind: 'image', mediaType: 'image/png' }, (done, total) => { progress.push([done, total]); },
        );
        assert.equal(imageResult.pages, 1);
        assert.deepEqual(progress, [[1, 1]]);
    });
});
