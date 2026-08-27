import { createHash } from 'crypto';

export function isDuplicateKeyError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000;
}

export function bulkSubmitItemIdentity(code: string) {
    return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function bulkSubmitClaimKey(
    domainId: string,
    contestId: string,
    pid: number,
    uid: number,
    itemIdentity: string,
) {
    return [domainId, contestId, String(pid), String(uid), itemIdentity].join('\0');
}

export async function completeJudgeRecordInsert<T>(opts: {
    claimKey?: string;
    insert: () => Promise<T>;
    findClaimed: () => Promise<T | null>;
    afterInsert: (id: T) => Promise<void>;
    onAfterInsertError?: (error: unknown, id: T) => void;
}): Promise<T> {
    let id: T;
    try {
        id = await opts.insert();
    } catch (error) {
        if (opts.claimKey && isDuplicateKeyError(error)) {
            const claimed = await opts.findClaimed();
            if (claimed != null) return claimed;
        }
        throw error;
    }
    try {
        await opts.afterInsert(id);
    } catch (error) {
        opts.onAfterInsertError?.(error, id);
    }
    return id;
}
