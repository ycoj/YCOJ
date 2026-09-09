import { Logger } from '../../logger';
import { BACKGROUND_TASK_TIMEOUT_MESSAGE, BackgroundTaskModel, backgroundTaskModel, type BackgroundTaskOwner } from '../../model/backgroundTask';

const logger = new Logger('background-task');
export interface BackgroundTaskDefinition<Payload = any, Result = any> {
    type: string;
    timeoutMs: number;
    retentionMs: number;
    run(payload: Payload, signal: AbortSignal): Promise<Result>;
    toPublic?(doc: any): any;
    timeoutError?: string;
}
export class BackgroundTaskService {
    private definitions = new Map<string, BackgroundTaskDefinition>();
    private active = new Set<Promise<void>>();
    private controllers = new Map<string, AbortController>();
    constructor(private store: BackgroundTaskModel = backgroundTaskModel) {}
    register(definition: BackgroundTaskDefinition) { if (this.definitions.has(definition.type)) throw new Error(`Background task type already registered: ${definition.type}`); this.definitions.set(definition.type, definition); return this; }
    async submit(type: string, owner: BackgroundTaskOwner, payload: any) {
        const d = this.require(type);
        const id = await this.store.submit(type, owner, payload);
        if (!id) return null;
        const p = this.run(id, d)
            .catch((error) => { logger.error('Job %s (%s) failed:', id, type, error); })
            .finally(() => this.active.delete(p));
        this.active.add(p);
        return { jobId: id, status: 'pending' as const };
    }

    async get(type: string, id: string, owner: BackgroundTaskOwner) { const d = this.require(type); const doc = await this.store.view(id, type, owner, d.timeoutMs, d.retentionMs); return doc && (d.toPublic ? d.toPublic(doc) : doc); }
    async sweep() { const now = new Date(); await Promise.all([...this.definitions.values()].map(d => this.store.reclaimStalled(d.type, d.timeoutMs, d.retentionMs, now))); await this.store.deleteExpired(now); }
    async drain() { while (this.active.size) await Promise.all([...this.active]); }
    dispose() { for (const c of this.controllers.values()) c.abort(); this.controllers.clear(); }
    private require(type: string) { const d = this.definitions.get(type); if (!d) throw new Error(`Unknown background task type: ${type}`); return d; }
    private async run(id: string, d: BackgroundTaskDefinition) {
        const doc = await this.store.claim(id, d.type);
        if (!doc) return;
        const c = new AbortController();
        this.controllers.set(id, c);
        const timer = setTimeout(() => c.abort(), d.timeoutMs);
        timer.unref();
        try {
            const result = await d.run(doc.payload, c.signal);
            if (c.signal.aborted) throw new Error('timeout');
            await this.store.finish(id, d.type, { result }, d.retentionMs);
        } catch (error) {
            logger.error('Job %s (%s) failed:', id, d.type, error);
            await this.store.finish(id, d.type, {
                error: c.signal.aborted ? (d.timeoutError ?? BACKGROUND_TASK_TIMEOUT_MESSAGE) : 'Background task failed.',
            }, d.retentionMs);
        } finally {
            clearTimeout(timer);
            this.controllers.delete(id);
        }
    }
}
export type RegisteredBackgroundRunner = BackgroundTaskService;
