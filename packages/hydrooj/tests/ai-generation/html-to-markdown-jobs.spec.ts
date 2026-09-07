import assert from 'assert';
import { setImmediate as tick, setTimeout as sleep } from 'timers/promises';
import { describe, it } from 'node:test';
import { HtmlToMarkdownJobs } from '../../src/lib/ai/html2md/jobs';

const owner = { domainId: 'test', pid: 1, uid: 2 };

describe('HTML-to-Markdown jobs', () => {
    it('returns immediately, snapshots input, isolates access and exposes only the result', async () => {
        let resolve: (value: string) => void;
        let signal: AbortSignal;
        const config = { model: 'original', apiKey: 'secret' } as any;
        const jobs = new HtmlToMarkdownJobs(async (snapshot, html, conversionSignal) => {
            assert.equal(snapshot.model, 'original');
            assert.equal(html, '<p>input</p>');
            signal = conversionSignal;
            return new Promise<string>((r) => { resolve = r; });
        });
        const job = jobs.submit(owner, config, '<p>input</p>');
        config.model = 'changed';
        assert.equal(job.status, 'pending');
        await tick();
        assert.equal(jobs.get(job.jobId, owner).status, 'running');
        assert.equal(signal.aborted, false);
        assert.equal(jobs.get(job.jobId, { ...owner, uid: 3 }), null);
        assert.equal(jobs.get(job.jobId, { ...owner, pid: 3 }), null);
        assert.equal(jobs.get(job.jobId, { ...owner, domainId: 'other' }), null);
        resolve('# Markdown');
        await tick();
        assert.deepEqual(jobs.get(job.jobId, owner), { jobId: job.jobId, status: 'completed', markdown: '# Markdown' });
        jobs.dispose();
        assert.equal(jobs.get(job.jobId, owner), null);
    });

    it('sanitizes failures and reclaims expired capacity', async () => {
        const jobs = new HtmlToMarkdownJobs(async () => { throw new Error('secret provider response'); },
            { capacity: 1, retentionMs: 20, timeoutMs: 1000 });
        const job = jobs.submit(owner, {} as any, '');
        assert.equal(jobs.submit(owner, {} as any, ''), null);
        await tick();
        assert.deepEqual(jobs.get(job.jobId, owner), {
            jobId: job.jobId, status: 'failed', error: 'HTML-to-Markdown conversion failed.',
        });
        await sleep(30);
        assert.equal(jobs.get(job.jobId, owner), null);
        assert.ok(jobs.submit(owner, {} as any, ''));
        jobs.dispose();
    });

    it('times out and ignores late results', async () => {
        let resolve: (value: string) => void;
        let signal: AbortSignal;
        const jobs = new HtmlToMarkdownJobs((_config, _html, conversionSignal) => {
            signal = conversionSignal;
            return new Promise((r) => { resolve = r; });
        }, { capacity: 1, retentionMs: 1000, timeoutMs: 10 });
        const job = jobs.submit(owner, {} as any, '');
        await tick();
        await sleep(20);
        const result = jobs.get(job.jobId, owner);
        assert.equal(result.status, 'failed');
        assert.equal(signal.aborted, true);
        resolve('late');
        await tick();
        assert.deepEqual(jobs.get(job.jobId, owner), result);
        jobs.dispose();
    });

    it('aborts active conversions when disposed', async () => {
        let signal: AbortSignal;
        const jobs = new HtmlToMarkdownJobs((_config, _html, conversionSignal) => {
            signal = conversionSignal;
            return new Promise(() => {});
        });
        jobs.submit(owner, {} as any, '');
        await tick();
        jobs.dispose();
        assert.equal(signal.aborted, true);
    });

    it('limits retained jobs per owner without changing shared capacity', () => {
        const jobs = new HtmlToMarkdownJobs(() => Promise.resolve('done'), {
            capacity: 3, capacityPerOwner: 2, retentionMs: 1000,
        });
        assert.ok(jobs.submit(owner, {} as any, ''));
        assert.ok(jobs.submit(owner, {} as any, ''));
        assert.equal(jobs.submit(owner, {} as any, ''), null);
        assert.ok(jobs.submit({ ...owner, pid: 2 }, {} as any, ''));
        jobs.dispose();
    });
});
