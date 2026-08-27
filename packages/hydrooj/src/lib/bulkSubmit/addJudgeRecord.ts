import { ObjectId } from 'mongodb';
import * as contest from '../../model/contest';
import domain from '../../model/domain';
import problem from '../../model/problem';
import record from '../../model/record';

export async function addJudgeRecord(
    domainId: string,
    pid: number,
    uid: number,
    lang: string,
    code: string,
    extra: { contest?: ObjectId, files?: Record<string, string> } = {},
) {
    const rid = await record.add(domainId, pid, uid, lang, code, true, {
        contest: extra.contest,
        files: extra.files,
        type: 'judge',
    });
    await Promise.all([
        problem.inc(domainId, pid, 'nSubmit', 1),
        domain.incUserInDomain(domainId, uid, 'nSubmit'),
        extra.contest && contest.updateStatus(domainId, extra.contest, uid, rid, pid),
    ]);
    return rid;
}
