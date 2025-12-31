/* eslint-disable no-await-in-loop */
import axios, { AxiosInstance } from 'axios';
import { STATUS } from '@hydrooj/common';
import { IBasicProvider, RemoteAccount } from '@hydrooj/vjudge/src/interface';
import { Logger, sleep, SystemModel } from 'hydrooj';

const logger = new Logger('remote/judge-client');

const judgingStatus = [
    STATUS.STATUS_FETCHED,
    STATUS.STATUS_COMPILING,
    STATUS.STATUS_JUDGING,
    STATUS.STATUS_WAITING,
];

function normalizeBaseUrl(input: string) {
    const url = (input || '').replace(/`/g, '').trim();
    return url.replace(/\/+$/, '');
}

function getDefaultUA() {
    const hydro = global.Hydro?.version?.hydrooj ?? 'unknown';
    const vjudge = global.Hydro?.version?.vjudge ?? 'unknown';
    const installId = String(SystemModel.get('installid') || '').substring(0, 16);
    return [`Hydro/${hydro}`, `(Instance Id ${installId})`, `Vjudge/${vjudge}`].join(' ');
}

export default class JudgeClientProvider implements IBasicProvider {
    quota: any = null;
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly client: AxiosInstance;

    constructor(public account: RemoteAccount, private save: (data: any) => Promise<void>) {
        this.baseUrl = normalizeBaseUrl(account.endpoint || '');
        this.token = String((account.password || SystemModel.get('judgeserver.token') || '')).replace(/`/g, '').trim();
        this.client = axios.create({
            baseURL: this.baseUrl || 'https://zshfoj.com/',
            headers: {
                Accept: 'application/json',
                'User-Agent': account.UA || getDefaultUA(),
            },
            timeout: 20000,
        });
        void this.save;
    }

    async ensureLogin() {
        return true;
    }

    async getProblem(id: string, meta: Record<string, any>) {
        void id;
        void meta;
        return null as any;
    }

    async listProblem(page: number, resyncFrom: number, listId: string) {
        void page;
        void resyncFrom;
        void listId;
        return [];
    }

    async submitProblem(id: string, lang: string, code: string, info: any, next: any, end: any) {
        void info;
        void next;

        if (!this.baseUrl) {
            end({ status: STATUS.STATUS_SYSTEM_ERROR, message: 'Judge client endpoint not configured (vjudge account.endpoint)' });
            return undefined;
        }
        if (!this.token) {
            end({ status: STATUS.STATUS_SYSTEM_ERROR, message: 'Judge server token not configured (vjudge account.password or judgeserver.token)' });
            return undefined;
        }
        if (!code?.length) {
            end({ status: STATUS.STATUS_COMPILE_ERROR, message: 'Empty code' });
            return undefined;
        }

        let submitRetries = 3;
        let data: any = null;
        while (submitRetries > 0) {
            try {
                const res = await this.client.post('/judge-server/judge', {
                    token: this.token,
                    pid: id,
                    code: encodeURI(code),
                    language: lang,
                });
                data = res.data;
                break;
            } catch (e) {
                submitRetries--;
                if (submitRetries <= 0) throw e;
                await sleep(500);
            }
        }

        if (!data?.success) {
            end({ status: STATUS.STATUS_SYSTEM_ERROR, message: data?.message || 'Submit failed' });
            return undefined;
        }
        return String(data.rid);
    }

    async waitForSubmission(id: string, next: any, end: any) {
        if (!this.baseUrl) {
            end({ status: STATUS.STATUS_SYSTEM_ERROR, message: 'Judge client endpoint not configured (vjudge account.endpoint)' });
            return;
        }
        if (!this.token) {
            end({ status: STATUS.STATUS_SYSTEM_ERROR, message: 'Judge server token not configured (vjudge account.password or judgeserver.token)' });
            return;
        }

        let done = false;
        let tries = 0;
        next({ status: STATUS.STATUS_JUDGING, progress: 10 });

        while (!done && tries <= 300) {
            await sleep(1000);
            tries++;

            let srdoc: any = null;
            let queryFailed = 0;
            while (queryFailed <= 3) {
                try {
                    const url = `/judge-server/record?token=${encodeURIComponent(this.token)}&rid=${encodeURIComponent(id)}`;
                    srdoc = (await this.client.get(url)).data;
                    break;
                } catch (e) {
                    queryFailed++;
                    if (queryFailed > 3) {
                        end({ status: STATUS.STATUS_SYSTEM_ERROR, message: 'Failed to get judge result from server.' });
                        return;
                    }
                    await sleep(500);
                }
            }

            if (!srdoc) continue;

            const progress = Math.min(99, Math.max(10, Math.floor((tries / 300) * 95)));
            if (judgingStatus.includes(srdoc.status)) {
                next({ status: srdoc.status, progress });
                continue;
            }

            if (Array.isArray(srdoc.compilerTexts)) {
                for (const t of srdoc.compilerTexts) {
                    if (typeof t === 'string' && t.length) next({ compilerText: t });
                }
            } else if (typeof srdoc.compilerText === 'string' && srdoc.compilerText.length) {
                next({ compilerText: srdoc.compilerText });
            }

            end({
                status: srdoc.status,
                score: srdoc.score,
                time: srdoc.time,
                memory: srdoc.memory,
                cases: srdoc.testCases,
                subtasks: srdoc.subtasks,
            });
            done = true;
        }

        if (!done) {
            logger.error('Judging timeout exceeded 300s.', { rid: id });
            end({ status: STATUS.STATUS_SYSTEM_ERROR, message: 'Judging timeout exceeded 300s.' });
        }
    }
}
