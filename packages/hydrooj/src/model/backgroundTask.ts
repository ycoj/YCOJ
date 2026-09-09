import { randomUUID } from 'crypto';
import { Collection, Filter, IndexDescription, ObjectId } from 'mongodb';
import db from '../service/db';

export type BackgroundTaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export interface BackgroundTaskOwner { domainId: string; pid: number; uid: number }
export interface BackgroundTaskDoc {
    _id: ObjectId; jobId: string; type: string; domainId: string; pid: number; uid: number;
    status: BackgroundTaskStatus; payload?: any; result?: any; error?: string;
    ownerSlot: number; globalSlot: number; createdAt: Date; claimedAt?: Date; finishedAt?: Date; expiresAt?: Date;
}
export const BACKGROUND_TASK_INDEXES: IndexDescription[] = [
    { key: { jobId: 1 }, name: 'jobId', unique: true },
    { key: { type: 1, domainId: 1, pid: 1, uid: 1, ownerSlot: 1 }, name: 'ownerSlot', unique: true },
    { key: { type: 1, globalSlot: 1 }, name: 'globalSlot', unique: true },
    { key: { type: 1, domainId: 1, pid: 1, uid: 1, status: 1 }, name: 'ownerStatus' },
    { key: { type: 1, status: 1, claimedAt: 1 }, name: 'statusClaimedAt' },
    { key: { type: 1, status: 1, createdAt: 1 }, name: 'statusCreatedAt' },
    { key: { expiresAt: 1 }, name: 'expire', expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } },
];
export function ensureBackgroundTaskIndexes(collection: Collection<BackgroundTaskDoc>) { return collection.createIndexes(BACKGROUND_TASK_INDEXES); }
const free = (used: Set<number>, cap: number) => { for (let i = 0; i < cap; i++) if (!used.has(i)) return i; return -1; };
export class BackgroundTaskModel {
    constructor(public coll: Collection<BackgroundTaskDoc> = db.collection('background_task'), public capacity = 100, public capacityPerOwner = 10) {}
    private filter(type: string, owner?: BackgroundTaskOwner, now = new Date()): Filter<BackgroundTaskDoc> {
        return { type, ...(owner || {}), $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] };
    }
    async submit(type: string, owner: BackgroundTaskOwner, payload?: any, now = new Date()) {
        await this.deleteExpired(now); const jobId = randomUUID();
        for (let i = 0; i < this.capacity + this.capacityPerOwner; i++) {
            const [a, g] = await Promise.all([
                this.coll.find(this.filter(type, owner, now), { projection: { ownerSlot: 1 } }).toArray(),
                this.coll.find(this.filter(type, undefined, now), { projection: { globalSlot: 1 } }).toArray(),
            ]);
            const ownerSlot = free(new Set(a.map(x => x.ownerSlot)), this.capacityPerOwner);
            const globalSlot = free(new Set(g.map(x => x.globalSlot)), this.capacity);
            if (ownerSlot < 0 || globalSlot < 0) return null;
            try { await this.coll.insertOne({ _id: new ObjectId(), jobId, type, ...owner, status: 'pending', payload, ownerSlot, globalSlot, createdAt: now }); return jobId; }
            catch (e: any) { if (e?.code !== 11000) throw e; }
        } return null;
    }
    claim(jobId: string, type: string, now = new Date()) { return this.coll.findOneAndUpdate({ jobId, type, status: 'pending' }, { $set: { status: 'running', claimedAt: now } }, { returnDocument: 'after' }); }
    finish(jobId: string, type: string, value: { result?: any, error?: string }, retentionMs: number, now = new Date()) {
        const failed = !!value.error; return this.coll.findOneAndUpdate({ jobId, type, status: 'running' }, { $set: { status: failed ? 'failed' : 'completed', ...(failed ? { error: value.error } : { result: value.result }), finishedAt: now, expiresAt: new Date(now.getTime() + retentionMs) }, $unset: failed ? { result: '' } : { error: '' } }, { returnDocument: 'after' });
    }
    get(jobId: string, type: string, owner: BackgroundTaskOwner) { return this.coll.findOne({ jobId, type, ...owner }); }
    async view(jobId: string, type: string, owner: BackgroundTaskOwner, timeoutMs: number, retentionMs: number): Promise<BackgroundTaskDoc | null> {
        const doc = await this.get(jobId, type, owner); if (!doc) return null; const now = Date.now();
        if (doc.expiresAt && doc.expiresAt.getTime() <= now) { await this.coll.deleteOne({ _id: doc._id }); return null; }
        if ((doc.status === 'pending' || doc.status === 'running') && now - (doc.status === 'running' ? doc.claimedAt! : doc.createdAt).getTime() > timeoutMs) {
            await this.coll.updateOne({ jobId, type, status: { $in: ['pending', 'running'] } }, { $set: { status: 'failed', error: 'Background task timed out.', finishedAt: new Date(), expiresAt: new Date(now + retentionMs) } });
            doc.status = 'failed'; doc.error = 'Background task timed out.';
        } return doc;
    }
    deleteExpired(now = new Date()) { return this.coll.deleteMany({ expiresAt: { $lte: now } }); }
    reclaimStalled(type: string, timeoutMs: number, retentionMs: number, now = new Date()) { const d = new Date(now.getTime() - timeoutMs); return this.coll.updateMany({ type, $or: [{ status: 'running', claimedAt: { $lt: d } }, { status: 'pending', createdAt: { $lt: d } }] }, { $set: { status: 'failed', error: 'Background task timed out.', finishedAt: now, expiresAt: new Date(now.getTime() + retentionMs) } }); }
}
export const backgroundTaskModel = new BackgroundTaskModel();
export async function apply(ctx: any) { await ctx.db.ensureIndexes(backgroundTaskModel.coll, ...BACKGROUND_TASK_INDEXES); }
global.Hydro.model.backgroundTask = backgroundTaskModel;
