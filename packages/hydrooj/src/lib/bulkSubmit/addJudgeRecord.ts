import { ObjectId } from 'mongodb';
import { Logger } from '../../logger';
import * as contest from '../../model/contest';
import domain from '../../model/domain';
import problem from '../../model/problem';
import record from '../../model/record';
import { isDuplicateKeyError } from '../mongodb';

const logger = new Logger('bulk-submit');

/** Insert a judge record and make its derived submission state recoverable. */
export async function addJudgeRecord(
    domainId: string,
    pid: number,
    uid: number,
    lang: string,
    code: string,
    extra: { contest?: ObjectId, files?: Record<string, string>, claimKey?: string } = {},
) {
    let rid: ObjectId;
    let claimed = false;
    try {
        rid = await record.add(domainId, pid, uid, lang, code, true, {
            contest: extra.contest,
            files: extra.files,
            type: 'judge',
            claimKey: extra.claimKey,
        });
    } catch (error) {
        if (!extra.claimKey || !isDuplicateKeyError(error)) throw error;
        const existing = await record.getByClaimKey(extra.claimKey);
        if (!existing) throw error;
        rid = existing._id;
        claimed = true;
    }

    if (claimed) {
        try {
            const priority = await record.submissionPriority(uid, 50);
            await record.judge(domainId, rid, priority, { detail: false });
        } catch (error) {
            logger.warn('Failed to re-enqueue claimed record %s: %s', rid, error instanceof Error ? error.message : String(error));
        }
    }

    try {
        await Promise.all([
            problem.inc(domainId, pid, 'nSubmit', 1),
            domain.incUserInDomain(domainId, uid, 'nSubmit'),
            extra.contest && contest.updateStatus(domainId, extra.contest, uid, rid, pid),
        ]);
    } catch (error) {
        if (!extra.claimKey) throw error;
        // The record is durable. A later retry runs this repair block again.
        logger.warn('Failed to update submission state for record %s: %s', rid, error instanceof Error ? error.message : String(error));
    }
    return rid;
}
