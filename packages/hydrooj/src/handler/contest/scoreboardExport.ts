import type { ObjectId } from 'mongodb';
import { PermissionError } from '../../error';
import type { Tdoc } from '../../interface';
import { PERM } from '../../model/builtin';
import * as contest from '../../model/contest';
import user from '../../model/user';
import type { ContestScoreboardHandler } from '../contest';

export async function getScoreboardExport(this: ContestScoreboardHandler, tdoc: Tdoc, details: boolean) {
    if (!this.user.own(tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
        throw new PermissionError(PERM.PERM_EDIT_CONTEST);
    }
    const lockAt = tdoc.unlocked ? undefined : tdoc.lockAt;
    const [, rows, users, pdict] = await contest.getScoreboard.call(this, tdoc.domainId, tdoc._id, {
        isExport: true, lockAt, showDisplayName: false,
    });
    const uids = Object.keys(users).map(Number);
    const exportUsers = await user.getListForRender(tdoc.domainId, uids, ['realName']);
    const udict = Object.fromEntries(uids.map((uid) => [uid, {
        _id: uid,
        uname: exportUsers[uid].uname,
        avatar: exportUsers[uid].avatar,
        realName: exportUsers[uid].realName || '',
    }]));
    const submissions: Record<number, { rid: ObjectId, pid: number, status: number, score: number, submittedAt: Date, lang?: string }[]> = {};
    if (details) {
        const statuses = await contest.getMultiStatus(tdoc.domainId, {
            docId: tdoc._id, attend: { $gt: 0 }, uid: { $in: uids },
        }).toArray();
        for (const uid of uids) submissions[uid] = [];
        for (const status of statuses) {
            submissions[status.uid] = (status.journal || [])
                .filter((entry) => tdoc.pids.includes(entry.pid)
                    && (!lockAt || entry.rid.getTimestamp() <= lockAt))
                .sort((a, b) => a.rid.toHexString().localeCompare(b.rid.toHexString()))
                .map((entry) => ({
                    rid: entry.rid, pid: entry.pid, status: entry.status, score: entry.score,
                    submittedAt: entry.rid.getTimestamp(), lang: entry.lang,
                }));
        }
    }
    return { tdoc, rows, udict, pdict, submissions };
}
