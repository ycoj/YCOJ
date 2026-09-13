import { readFile } from 'fs-extra';
import { Context } from '../context';
import {
    MarkdownOcrCapacityError, NotFoundError, ValidationError,
} from '../error';
import type { PublicAiModelProfile } from '../lib/ai/config';
import {
    convertFileToMarkdown, detectMarkdownOcrFileType, MARKDOWN_OCR_IMAGE_MEDIA_TYPES,
    MAX_MARKDOWN_OCR_FILE_SIZE, MAX_MARKDOWN_OCR_PAGES,
} from '../lib/ai/ocr/converter';
import { MarkdownOcrJobs } from '../lib/ai/ocr/jobs';
import { getMarkdownOcrConfig } from '../lib/ai/ocr/runtime';
import { validateMarkdownOcrConfig } from '../lib/ai/ocr/validation';
import { getConfiguredAiModelProfiles } from '../lib/ai/runtime';
import { validateAiModelRuntimeConfig } from '../lib/ai/validation';
import { PRIV } from '../model/builtin';
import { Handler, post, route, Types } from '../service/server';

declare module 'cordis' {
    interface Context {
        markdownOcrJobs: MarkdownOcrJobs;
    }
}

// The single runner instance is owned by the cordis context: apply(ctx) below creates it (or
// accepts one provided earlier on the context — the only injection seam), and the sweep, dispose,
// and both handlers all read that exact same service instance. MarkdownOcrJobs is a thin adapter
// that registers the conversion definition on a BackgroundTaskService.
function getJobs(handler: Handler): MarkdownOcrJobs {
    const jobs = handler.ctx.get('markdownOcrJobs');
    if (!jobs) throw new Error('Markdown OCR job runner is not registered.');
    return jobs;
}

function getPublicMarkdownOcrProfiles(): PublicAiModelProfile[] {
    return getConfiguredAiModelProfiles().flatMap((profile) => {
        try {
            validateAiModelRuntimeConfig({ ...getMarkdownOcrConfig(profile.id), enabled: true });
            return [{ id: profile.id, label: profile.label, model: profile.model }];
        } catch {
            return [];
        }
    });
}

// The standalone Markdown OCR page and its submit route. GET renders the tool page; POST admits an
// asynchronous conversion of the uploaded image or PDF into problem Markdown and returns 202 with
// the pending job. The uploaded file is read into memory before the response: upload temp files are
// removed when the request ends, and the job itself runs in this process with the bytes passed as
// the (unpersisted) runtime payload — the stored job doc carries only redacted metadata.
export class MarkdownOcrHandler extends Handler {
    async get() {
        const config = getMarkdownOcrConfig();
        let enabled = false;
        try {
            validateMarkdownOcrConfig(config);
            enabled = true;
        } catch { /* OCR stays disabled on the page when unconfigured. */ }
        this.response.template = 'markdown_ocr.html';
        this.response.body = {
            enabled,
            profiles: enabled ? getPublicMarkdownOcrProfiles() : [],
            maxFileSize: MAX_MARKDOWN_OCR_FILE_SIZE,
            maxPages: MAX_MARKDOWN_OCR_PAGES,
            imageMediaTypes: MARKDOWN_OCR_IMAGE_MEDIA_TYPES,
        };
    }

    @post('profileId', Types.String, true)
    async post(domainId: string, profileId = '') {
        const config = getMarkdownOcrConfig(profileId);
        validateMarkdownOcrConfig(config);
        const uploaded = this.request.files?.file;
        const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;
        if (!file || !file.size) throw new ValidationError('file');
        if (file.size > MAX_MARKDOWN_OCR_FILE_SIZE) {
            throw new ValidationError('file', `File exceeds ${MAX_MARKDOWN_OCR_FILE_SIZE} bytes.`);
        }
        const data = await readFile(file.filepath);
        const detected = detectMarkdownOcrFileType(data, file.mimetype, file.originalFilename);
        if (!detected) throw new ValidationError('file', 'Only PNG, JPEG, GIF, WebP, and PDF files are supported.');
        const result = await getJobs(this).submit(
            { domainId, pid: 0, uid: this.user._id }, config,
            { data, ...detected },
            { filename: file.originalFilename, size: file.size },
        );
        if (!result) throw new MarkdownOcrCapacityError();
        this.response.status = 202;
        this.response.type = 'application/json';
        this.response.body = result;
    }
}

export class MarkdownOcrJobHandler extends Handler {
    @route('jobId', Types.String)
    async get(domainId: string, jobId: string) {
        const result = await getJobs(this).get(jobId, { domainId, pid: 0, uid: this.user._id });
        if (!result) throw new NotFoundError(jobId);
        this.response.type = 'application/json';
        this.response.body = result;
    }
}

export async function apply(ctx: Context) {
    const provided = ctx.get('markdownOcrJobs');
    const jobs = provided ?? new MarkdownOcrJobs(convertFileToMarkdown);
    if (!provided) ctx.provide('markdownOcrJobs', jobs);
    ctx.effect(() => () => jobs.dispose());
    // Only the PM2 master (instance 0) runs the periodic stale reclaim/expiry sweep, mirroring
    // aiGeneration's single-worker cleanup; every worker still reclaims stalled jobs on poll.
    if (process.env.NODE_APP_INSTANCE === '0') {
        ctx.effect(() => {
            const timer = setInterval(() => void jobs.sweep(), 60_000);
            timer.unref();
            return () => clearInterval(timer);
        });
    }
    ctx.Route('markdown_ocr', '/tools/markdown-ocr', MarkdownOcrHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('markdown_ocr_job', '/tools/markdown-ocr/:jobId', MarkdownOcrJobHandler, PRIV.PRIV_USER_PROFILE);
    ctx.injectUI('UserDropdown', 'markdown_ocr', () => ({ icon: 'insert--image', displayName: 'Markdown OCR' }), PRIV.PRIV_USER_PROFILE);
}
