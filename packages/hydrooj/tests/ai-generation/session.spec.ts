import assert from 'assert';
import { describe, it } from 'node:test';
import {
    GoJudgeSessionClient, SessionError, validateSessionPath,
} from '../../src/lib/ai/testdata/session';

describe('go-judge Session client', () => {
    it('sends bearer authentication and fixed session limits', async () => {
        let request: { url: string, init: RequestInit };
        const client = new GoJudgeSessionClient({
            baseUrl: 'http://sandbox:5050/',
            token: 'secret',
            fetch: async (url, init) => {
                request = { url: String(url), init };
                return Response.json({ sessionId: 'sess_1', createdAt: 1 });
            },
        });
        assert.deepEqual(await client.create(), { sessionId: 'sess_1', createdAt: 1 });
        assert.equal(request.url, 'http://sandbox:5050/session');
        assert.equal(new Headers(request.init.headers).get('authorization'), 'Bearer secret');
        assert.deepEqual(JSON.parse(request.init.body as string), { ttl: 1800, maxDiskMB: 1024 });
    });

    it('rejects paths that can escape or confuse the workspace', () => {
        for (const invalid of ['', '/etc/passwd', '../x', 'a/../b', './x', 'a//b', 'C:/x', 'a\\b']) {
            assert.throws(() => validateSessionPath(invalid), SessionError);
        }
        assert.equal(validateSessionPath('docs/cyaron.md'), 'docs/cyaron.md');
    });

    it('maps HTTP errors to stable categories', async () => {
        const errors = [
            [400, 'bad_request'], [401, 'auth'], [404, 'not_found'],
            [408, 'timeout'], [413, 'quota'], [500, 'server'],
        ] as const;
        for (const [status, kind] of errors) {
            const client = new GoJudgeSessionClient({
                baseUrl: 'http://sandbox:5050',
                fetch: async () => Response.json({ error: `failure-${status}` }, { status }),
            });
            // eslint-disable-next-line no-await-in-loop
            await assert.rejects(client.create(), (err: SessionError) => err.kind === kind && err.message === `failure-${status}`);
        }
    });

    it('times out a stalled request', async () => {
        const client = new GoJudgeSessionClient({
            baseUrl: 'http://sandbox:5050',
            requestTimeoutMs: 10,
            fetch: async (_url, init) => await new Promise((_resolve, reject) => {
                const keepAlive = setTimeout(() => reject(new Error('timeout signal was not delivered')), 100);
                init.signal.addEventListener('abort', () => {
                    clearTimeout(keepAlive);
                    reject(init.signal.reason);
                }, { once: true });
            }),
        });
        await assert.rejects(client.create(), (err: SessionError) => err.kind === 'timeout');
    });

    it('uses the fixed shell entrypoint and explicit resource limits', async () => {
        let body: any;
        const client = new GoJudgeSessionClient({
            baseUrl: 'http://sandbox:5050',
            fetch: async (_url, init) => {
                body = JSON.parse(init.body as string);
                return Response.json({
                    status: 'Accepted', exitStatus: 0, time: 1, memory: 2, runTime: 3,
                    stdout: 'ok\n', stderr: '', error: '',
                });
            },
        });
        await client.execShell('sess_1', 'python3 generator.py', undefined, {
            cpuLimit: 4_000_000_000,
            clockLimit: 5_000_000_000,
        });
        assert.deepEqual(body.args, ['/bin/sh', '-lc', 'python3 generator.py']);
        assert.equal(body.cpuLimit, 4_000_000_000);
        assert.equal(body.clockLimit, 5_000_000_000);
        assert.equal(body.memoryLimit, 512 * 1024 * 1024);
        assert.equal(body.procLimit, 32);
        assert.match(body.env.join('\n'), /^HOME=\/w/m);
    });

    it('applies Read offsets, line limits, and output truncation', async () => {
        const client = new GoJudgeSessionClient({
            baseUrl: 'http://sandbox:5050',
            fetch: async () => new Response('one\ntwo\nthree\nfour\n'),
        });
        const lines = await client.readText('sess_1', 'problem.md', 2, 2);
        assert.equal(lines.content, 'two\nthree');
        assert.equal(lines.truncated, true);
        const bytes = await client.readText('sess_1', 'problem.md', 1, 4, 5);
        assert.match(bytes.content, /truncated/);
        await assert.rejects(client.readFile('sess_1', 'problem.md', undefined, 4), (err: SessionError) => err.kind === 'quota');
    });

    it('destroys sessions and treats an already missing session as clean', async () => {
        let deletes = 0;
        const client = new GoJudgeSessionClient({
            baseUrl: 'http://sandbox:5050',
            fetch: async (_url, init) => {
                assert.equal(init.method, 'DELETE');
                deletes++;
                return deletes === 1
                    ? Response.json({ status: 'ok' })
                    : Response.json({ error: 'session not found' }, { status: 404 });
            },
        });
        await client.destroy('sess_1');
        await client.destroy('sess_1');
        assert.equal(deletes, 2);
    });
});
