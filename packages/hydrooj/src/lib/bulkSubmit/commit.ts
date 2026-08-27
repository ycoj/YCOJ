import { ObjectId } from 'mongodb';
import { ContestAlreadyAttendedError } from '../../error';
import * as contest from '../../model/contest';
import user from '../../model/user';
import { addJudgeRecord } from './addJudgeRecord';
import {
    BulkSubmitUser, PreparedBulkSubmit, SKIP_SUBMIT, ZipLayoutSkip,
} from './inspect';

async function ensureAttended(domainId: string, tid: ObjectId, uid: number, beginAt: Date) {
    try {
        await contest.attend(domainId, tid, uid, { startAt: beginAt });
    } catch (e) {
        if (!(e instanceof ContestAlreadyAttendedError)) throw e;
        const tsdoc = await contest.getStatus(domainId, tid, uid);
        if (tsdoc && !tsdoc.startAt) await contest.setStatus(domainId, tid, uid, { startAt: beginAt });
    }
}

export async function commitContestBulkSubmit(opts: {
    domainId: string;
    tid: ObjectId;
    beginAt: Date;
    lang: string;
    ready: PreparedBulkSubmit[];
    usersPreview: BulkSubmitUser[];
    skipped: ZipLayoutSkip[];
}) {
    const skipped = [...opts.skipped];
    const submitted: { uname: string, uid: number, pid: number, rid: ObjectId }[] = [];
    const users: BulkSubmitUser[] = [];
    const filesByUname = new Map<string, PreparedBulkSubmit[]>();
    for (const item of opts.ready) {
        const list = filesByUname.get(item.uname);
        if (list) list.push(item);
        else filesByUname.set(item.uname, [item]);
    }
    for (const preview of opts.usersPreview) {
        let uid: number;
        switch (preview.kind) {
            case 'user':
                uid = preview.uid;
                break;
            case 'vuser':
                uid = (preview.created || !preview.uid)
                    ? await user.ensureVuser(preview.uname)
                    : preview.uid;
                break;
            default: {
                const _exhaustive: never = preview.kind;
                throw new Error(`Unknown bulk submit identity kind: ${_exhaustive}`);
            }
        }
        await ensureAttended(opts.domainId, opts.tid, uid, opts.beginAt);
        users.push({ ...preview, uid });
        for (const item of filesByUname.get(preview.uname) || []) {
            try {
                const rid = await addJudgeRecord(
                    opts.domainId, item.pid, uid, opts.lang, item.code,
                    { contest: opts.tid },
                );
                submitted.push({
                    uname: item.uname, uid, pid: item.pid, rid,
                });
            } catch (e) {
                skipped.push({
                    uname: item.uname,
                    problem: item.problemName,
                    reason: e.message || SKIP_SUBMIT,
                });
            }
        }
    }
    return { users, submitted, skipped };
}
