/* eslint-disable no-await-in-loop */
import { ObjectId } from 'mongodb';
import { ContestAlreadyAttendedError } from '../../error';
import * as contest from '../../model/contest';
import domain from '../../model/domain';
import problem from '../../model/problem';
import record from '../../model/record';
import user from '../../model/user';
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
        const items = filesByUname.get(preview.uname);
        if (!items?.length) continue;
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
        for (const item of items) {
            try {
                const rid = await record.add(
                    opts.domainId, item.pid, uid, opts.lang, item.code, true,
                    { contest: opts.tid, type: 'judge' },
                );
                await Promise.all([
                    problem.inc(opts.domainId, item.pid, 'nSubmit', 1),
                    domain.incUserInDomain(opts.domainId, uid, 'nSubmit'),
                    contest.updateStatus(opts.domainId, opts.tid, uid, rid, item.pid),
                ]);
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
