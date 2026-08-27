import { createHash } from 'crypto';
export { isDuplicateKeyError } from '../mongodb';

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
