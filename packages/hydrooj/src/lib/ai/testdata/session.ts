export type SessionErrorKind = 'auth' | 'bad_request' | 'not_found' | 'quota' | 'timeout' | 'cancelled' | 'server';

export class SessionError extends Error {
    constructor(public kind: SessionErrorKind, message: string, public status?: number) {
        super(message);
        this.name = 'SessionError';
    }
}

export interface SessionFile {
    name: string;
    size: number;
    modTime: number;
}

export interface SessionExecResult {
    status: string;
    exitStatus: number;
    time: number;
    memory: number;
    runTime: number;
    stdout: string;
    stderr: string;
    error: string;
}

export interface SessionClientOptions {
    baseUrl: string;
    token?: string;
    requestTimeoutMs?: number;
    fetch?: typeof globalThis.fetch;
}

export interface ShellLimits {
    cpuLimit: number;
    clockLimit: number;
    memoryLimit: number;
    procLimit: number;
    outputLimit: number;
}

export const DEFAULT_SHELL_LIMITS: ShellLimits = {
    cpuLimit: 10_000_000_000,
    clockLimit: 30_000_000_000,
    memoryLimit: 512 * 1024 * 1024,
    procLimit: 32,
    outputLimit: 64 * 1024,
};

const MAX_FILE_BYTES = 16 * 1024 * 1024;

export function validateSessionPath(filepath: string) {
    if (!filepath || filepath.includes('\0') || filepath.includes('\\')) throw new SessionError('bad_request', 'Invalid relative path.');
    if (filepath.startsWith('/') || /^[a-zA-Z]:/.test(filepath)) throw new SessionError('bad_request', 'Absolute paths are not allowed.');
    const parts = filepath.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) throw new SessionError('bad_request', 'Invalid relative path.');
    return parts.join('/');
}

function encodePath(filepath: string) {
    return validateSessionPath(filepath).split('/').map(encodeURIComponent).join('/');
}

function truncateOutput(value: string, maxBytes: number) {
    const buf = Buffer.from(value);
    if (buf.length <= maxBytes) return value;
    return `${buf.subarray(0, maxBytes).toString('utf8')}\n... [truncated ${buf.length - maxBytes} bytes]`;
}

function errorKind(status: number): SessionErrorKind {
    if (status === 401 || status === 403) return 'auth';
    if (status === 400) return 'bad_request';
    if (status === 404) return 'not_found';
    if (status === 408) return 'timeout';
    if (status === 413) return 'quota';
    return 'server';
}

async function readBoundedBody(response: Response, maxBytes: number) {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
        while (true) {
            // eslint-disable-next-line no-await-in-loop
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                // eslint-disable-next-line no-await-in-loop
                await reader.cancel();
                throw new SessionError('quota', `File exceeds ${maxBytes} bytes.`);
            }
            chunks.push(Buffer.from(value));
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
}

export class GoJudgeSessionClient {
    private readonly baseUrl: string;
    private readonly token?: string;
    private readonly requestTimeoutMs: number;
    private readonly fetchImpl: typeof globalThis.fetch;

    constructor(options: SessionClientOptions) {
        if (!/^https?:\/\//.test(options.baseUrl)) throw new SessionError('bad_request', 'Sandbox host must be an HTTP(S) URL.');
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.requestTimeoutMs = options.requestTimeoutMs || 60_000;
        this.fetchImpl = options.fetch || globalThis.fetch;
    }

    private signal(signal?: AbortSignal) {
        const timeout = AbortSignal.timeout(this.requestTimeoutMs);
        return signal ? AbortSignal.any([signal, timeout]) : timeout;
    }

    private async request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
        const headers = new Headers(init.headers);
        if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
        try {
            const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                ...init,
                headers,
                signal: this.signal(signal),
            });
            if (!response.ok) {
                let message = `go-judge session request failed (${response.status})`;
                try {
                    const body = await response.json() as { error?: string };
                    if (body.error) message = body.error;
                } catch { /* use the status message */ }
                throw new SessionError(errorKind(response.status), message, response.status);
            }
            return response;
        } catch (err) {
            if (err instanceof SessionError) throw err;
            if (signal?.aborted) throw new SessionError('cancelled', 'Session request was cancelled.');
            if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
                throw new SessionError('timeout', 'Session request timed out.');
            }
            throw new SessionError('server', err instanceof Error ? err.message : String(err));
        }
    }

    async create(signal?: AbortSignal) {
        const response = await this.request('/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: 1800, maxDiskMB: 1024 }),
        }, signal);
        const result = await response.json() as { sessionId?: string, createdAt?: number };
        if (!result.sessionId) throw new SessionError('server', 'go-judge returned an invalid session id.');
        return { sessionId: result.sessionId, createdAt: result.createdAt };
    }

    async writeFile(sessionId: string, filepath: string, content: string | Buffer, signal?: AbortSignal) {
        const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
        if (data.length > MAX_FILE_BYTES) throw new SessionError('quota', `File exceeds ${MAX_FILE_BYTES} bytes.`);
        await this.request(`/session/${encodeURIComponent(sessionId)}/file/${encodePath(filepath)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: data,
        }, signal);
    }

    async readFile(
        sessionId: string, filepath: string, signal?: AbortSignal, maxBytes = MAX_FILE_BYTES,
    ) {
        const response = await this.request(
            `/session/${encodeURIComponent(sessionId)}/file/${encodePath(filepath)}`,
            {}, signal,
        );
        const length = +(response.headers.get('content-length') || 0);
        if (length > maxBytes) throw new SessionError('quota', `File exceeds ${maxBytes} bytes.`);
        return await readBoundedBody(response, maxBytes);
    }

    async readText(
        sessionId: string, filepath: string, offset = 1, limit = 2000,
        maxOutputBytes = 64 * 1024, signal?: AbortSignal,
    ) {
        if (!Number.isSafeInteger(offset) || offset < 1) throw new SessionError('bad_request', 'Read offset must be at least 1.');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) {
            throw new SessionError('bad_request', 'Read limit must be between 1 and 2000.');
        }
        const text = (await this.readFile(sessionId, filepath, signal)).toString('utf8');
        const lines = text.split('\n');
        const selected = lines.slice(offset - 1, offset - 1 + limit).join('\n');
        const content = truncateOutput(selected, maxOutputBytes);
        return {
            content,
            offset,
            lines: Math.min(limit, Math.max(0, lines.length - offset + 1)),
            totalLines: lines.length,
            truncated: content !== selected || offset - 1 + limit < lines.length,
        };
    }

    async listFiles(sessionId: string, signal?: AbortSignal) {
        const response = await this.request(`/session/${encodeURIComponent(sessionId)}/files`, {}, signal);
        const result = await response.json() as { files?: SessionFile[] };
        if (!Array.isArray(result.files)) throw new SessionError('server', 'go-judge returned an invalid file list.');
        return result.files;
    }

    async execShell(
        sessionId: string, command: string, signal?: AbortSignal,
        overrides: Partial<Pick<ShellLimits, 'cpuLimit' | 'clockLimit'>> = {},
    ) {
        if (!command.trim() || command.length > 16_384) throw new SessionError('bad_request', 'Shell command is empty or too long.');
        const limits = { ...DEFAULT_SHELL_LIMITS, ...overrides };
        const response = await this.request(`/session/${encodeURIComponent(sessionId)}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                args: ['/bin/sh', '-lc', command],
                env: ['HOME=/w', 'LANG=C.UTF-8', 'LC_ALL=C.UTF-8', 'PATH=/usr/local/bin:/usr/bin:/bin'],
                cpuLimit: limits.cpuLimit,
                clockLimit: limits.clockLimit,
                memoryLimit: limits.memoryLimit,
                procLimit: limits.procLimit,
                stdin: '',
            }),
        }, signal);
        const result = await response.json() as SessionExecResult;
        if (!result || typeof result.status !== 'string') throw new SessionError('server', 'go-judge returned an invalid exec result.');
        result.stdout = truncateOutput(result.stdout || '', limits.outputLimit);
        result.stderr = truncateOutput(result.stderr || '', limits.outputLimit);
        result.error = truncateOutput(result.error || '', limits.outputLimit);
        return result;
    }

    async destroy(sessionId: string, signal?: AbortSignal) {
        try {
            await this.request(`/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }, signal);
        } catch (err) {
            if (!(err instanceof SessionError) || err.kind !== 'not_found') throw err;
        }
    }
}
