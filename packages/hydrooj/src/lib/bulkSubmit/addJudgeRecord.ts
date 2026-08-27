import { ObjectId } from 'mongodb';
import { Logger } from '../../logger';
import * as contest from '../../model/contest';
import domain from '../../model/domain';
import problem from '../../model/problem';
import record from '../../model/record';
import { completeJudgeRecordInsert } from './claim';

const logger = new Logger('bulk-submit');

export async function addJudgeRecord(
    domainId: string,
    pid: number,
    uid: number,
    lang: string,
    code: string,
    extra: { contest?: ObjectId, files?: Record<string, string>, claimKey?: string } = {},
) {
    return await completeJudgeRecordInsert({
        claimKey: extra.claimKey,
        insert: () => record.add(domainId, pid, uid, lang, code, true, {
            contest: extra.contest,
            files: extra.files,
            type: 'judge',
            claimKey: extra.claimKey,
        }),
        findClaimed: async () => {
            const existing = extra.claimKey
                ? await record.getByClaimKey(extra.claimKey)
                : null;
            return existing?._id ?? null;
        },
        afterInsert: async (rid) => {
            await Promise.all([
                problem.inc(domainId, pid, 'nSubmit', 1),
                domain.incUserInDomain(domainId, uid, 'nSubmit'),
                extra.contest && contest.updateStatus(domainId, extra.contest, uid, rid, pid),
            ]);
        },
        onAfterInsertError: (error, rid) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn('Failed to update submission counters for record %s: %s', rid, message);
        },
    });
}
