// Side-effect: register contest/del solution cleanup. builtinModel only loads contest/index.ts,
// so CLI and other scripts that call contest.del would otherwise leave orphaned solution docs.
import './solution';

import { Filter, ObjectId } from 'mongodb';
import { getAlphabeticId, sleep } from '@hydrooj/utils/lib/utils';
import { Context } from '../../context';
import { ContestAlreadyAttendedError, ContestNotFoundError, ContestScoreboardHiddenError, ValidationError } from '../../error';
import type {
    BaseUserDict, ContestJournalEntry, ContestPrintDoc, ContestStatusDoc, ProblemDict,
    RecordDoc, ScoreboardConfig, ScoreboardRow, SubtaskResult, Tdoc,
} from '../../interface';
import avatar from '../../lib/avatar';
import bus from '../../service/bus';
import db from '../../service/db';
import type { Handler } from '../../service/server';
import { PERM, STATUS } from '../builtin';
import * as document from '../document';
import MessageModel from '../message';
import problem, { ProblemModel } from '../problem';
import RecordModel from '../record';
import UserModel, { User } from '../user';
import { buildContestRule, isDone, isExtended, isLocked, isNew, isNotStarted, isOngoing, isUpcoming, PrintTaskStatus } from './common';
import { RULES } from './rules';

export * from './common';
export { RULES } from './rules';
const collBalloon = db.collection('contest.balloon');

function _getStatusJournal(tsdoc: ContestStatusDoc): ContestJournalEntry[] {
    return tsdoc.journal!.sort((a, b) => (a.rid.getTimestamp().getTime() - b.rid.getTimestamp().getTime()));
}

export async function add(
    domainId: string, title: string, content: string, owner: number,
    rule: string, beginAt = new Date(), endAt = new Date(), pids: number[] = [],
    rated = false, data: Partial<Tdoc> = {},
) {
    if (!RULES[rule]) throw new ValidationError('rule');
    if (beginAt >= endAt) throw new ValidationError('beginAt', 'endAt');
    Object.assign(data, {
        content, owner, title, rule, beginAt, endAt, pids, attend: 0,
    });
    RULES[rule].check(data);
    await bus.parallel('contest/before-add', data);
    const docId = await document.add(domainId, content, owner, document.TYPE_CONTEST, null, null, null, {
        assign: [], ...data, title, rule, beginAt, endAt, pids, attend: 0, rated,
    });
    await bus.parallel('contest/add', data, docId);
    return docId;
}

export async function edit(domainId: string, tid: ObjectId, $set: Partial<Tdoc>) {
    if ($set.rule && !RULES[$set.rule]) throw new ValidationError('rule');
    const tdoc = await document.get(domainId, document.TYPE_CONTEST, tid);
    if (!tdoc) throw new ContestNotFoundError(domainId, tid);
    await bus.parallel('contest/before-edit', tdoc, $set);
    RULES[$set.rule || tdoc.rule].check(Object.assign(tdoc, $set));
    const res = await document.set(domainId, document.TYPE_CONTEST, tid, $set);
    await bus.parallel('contest/edit', res);
    return res;
}

export async function del(domainId: string, tid: ObjectId) {
    await Promise.all([
        bus.parallel('contest/del', domainId, tid),
        document.deleteOne(domainId, document.TYPE_CONTEST, tid),
        document.deleteMultiStatus(domainId, document.TYPE_CONTEST, { docId: tid }),
    ]);
}

export async function get(domainId: string, tid: ObjectId): Promise<Tdoc> {
    const tdoc = await document.get(domainId, document.TYPE_CONTEST, tid);
    if (!tdoc) throw new ContestNotFoundError(domainId, tid);
    return tdoc;
}

export async function getRelated(domainId: string, pid: number, rule?: string) {
    const rules = Object.keys(RULES).filter((i) => !RULES[i].hidden);
    return await document.getMulti(domainId, document.TYPE_CONTEST, { pids: pid, rule: rule || { $in: rules } }).toArray();
}

export async function addBalloon(domainId: string, tid: ObjectId, uid: number, rid: ObjectId, pid: number) {
    const balloon = await collBalloon.find({ domainId, tid, pid }).project({ uid: 1 }).toArray();
    if (balloon.find((i) => i.uid === uid)) return null;
    let isFirst = !balloon.length;
    if (isFirst) {
        let pending: RecordDoc[] = [];
        do {
            if (pending.length) await sleep(500); // eslint-disable-line no-await-in-loop
            pending = await RecordModel.getMulti(domainId, { // eslint-disable-line no-await-in-loop
                pid, contest: tid, _id: { $lt: rid }, status: {
                    $in: [
                        STATUS.STATUS_WAITING, STATUS.STATUS_COMPILING,
                        STATUS.STATUS_JUDGING, STATUS.STATUS_FETCHED,
                        STATUS.STATUS_ACCEPTED,
                    ],
                },
            }).limit(1).toArray();
        } while (pending.length && !pending.some((i) => i.status === STATUS.STATUS_ACCEPTED));
        if (pending.some((i) => i.status === STATUS.STATUS_ACCEPTED)) isFirst = false;
    }
    const newBdoc = {
        _id: rid, domainId, tid, pid, uid, ...(isFirst ? { first: true } : {}),
    };
    await collBalloon.insertOne(newBdoc);
    bus.emit('contest/balloon', domainId, tid, newBdoc);
    return rid;
}

export async function getBalloon(domainId: string, tid: ObjectId, _id: ObjectId) {
    return await collBalloon.findOne({ domainId, tid, _id });
}

export function getMultiBalloon(domainId: string, tid: ObjectId, query: any = {}) {
    return collBalloon.find({ domainId, tid, ...query });
}

export async function updateBalloon(domainId: string, tid: ObjectId, _id: ObjectId, $set: any) {
    return await collBalloon.findOneAndUpdate({ domainId, tid, _id }, { $set });
}

export async function getStatus(domainId: string, tid: ObjectId, uid: number) {
    return await document.getStatus(domainId, document.TYPE_CONTEST, tid, uid);
}

export async function updateStatus(
    domainId: string, tid: ObjectId, uid: number, rid: ObjectId, pid: number,
    {
        status = STATUS.STATUS_WAITING,
        score = 0,
        subtasks,
        lang,
    }: { status?: STATUS, score?: number, subtasks?: Record<number, SubtaskResult>, lang?: string } = {},
) {
    const tdoc = await get(domainId, tid);
    if (tdoc.balloon && status === STATUS.STATUS_ACCEPTED && !isLocked(tdoc)) await addBalloon(domainId, tid, uid, rid, pid);
    const tsdoc = await document.revPushStatus(tdoc.domainId, document.TYPE_CONTEST, tdoc.docId, uid, 'journal', {
        rid, pid, status, score, subtasks, lang,
    }, 'rid');
    const journal = _getStatusJournal(tsdoc);
    const stats = RULES[tdoc.rule].stat(tdoc, journal);
    return await document.revSetStatus(tdoc.domainId, document.TYPE_CONTEST, tdoc.docId, uid, tsdoc.rev, { journal, ...stats });
}

export async function getListStatus(domainId: string, uid: number, tids: ObjectId[]) {
    const r = {};
    // eslint-disable-next-line no-await-in-loop
    for (const tid of tids) r[tid.toHexString()] = await getStatus(domainId, tid, uid);
    return r;
}

export async function attend(domainId: string, tid: ObjectId, uid: number, payload: any = {}) {
    try {
        await document.cappedIncStatus(domainId, document.TYPE_CONTEST, tid, uid, 'attend', 1, 0, 1, payload);
    } catch (e) {
        throw new ContestAlreadyAttendedError(tid, uid);
    }
    await document.inc(domainId, document.TYPE_CONTEST, tid, 'attend', 1);
    return {};
}

export async function cancelAttend(domainId: string, tid: ObjectId, uid: number) {
    await document.deleteMultiStatus(domainId, document.TYPE_CONTEST, { docId: tid, uid });
    await document.inc(domainId, document.TYPE_CONTEST, tid, 'attend', -1);
    return {};
}

export function getMultiStatus(domainId: string, query: any) {
    return document.getMultiStatus(domainId, document.TYPE_CONTEST, query);
}

export function setStatus(domainId: string, tid: ObjectId, uid: number, $set?: any, $unset?: any) {
    return document.setStatus(domainId, document.TYPE_CONTEST, tid, uid, $set, $unset);
}

export function count(domainId: string, query: any) {
    return document.count(domainId, document.TYPE_CONTEST, query);
}

export function countStatus(domainId: string, query: any) {
    return document.countStatus(domainId, document.TYPE_CONTEST, query);
}

export function getMulti(
    domainId: string, query: Filter<document.DocType['30']> = {},
) {
    return document.getMulti(domainId, document.TYPE_CONTEST, query).sort({ beginAt: -1 });
}

export async function getAndListStatus(domainId: string, tid: ObjectId): Promise<[Tdoc, any[]]> {
    // TODO(iceboy): projection, pagination.
    const tdoc = await get(domainId, tid);
    const tsdocs = await document.getMultiStatus(domainId, document.TYPE_CONTEST, { docId: tid })
        .sort(RULES[tdoc.rule].statusSort).toArray();
    return [tdoc, tsdocs];
}

export async function recalcStatus(domainId: string, tid: ObjectId) {
    const [tdoc, tsdocs] = await Promise.all([
        document.get(domainId, document.TYPE_CONTEST, tid),
        document.getMultiStatus(domainId, document.TYPE_CONTEST, { docId: tid }).toArray(),
    ]);
    const tasks = [];
    for (const tsdoc of tsdocs || []) {
        if (tsdoc.journal) {
            const journal = _getStatusJournal(tsdoc);
            const stats = RULES[tdoc.rule].stat(tdoc, journal);
            tasks.push(
                document.revSetStatus(
                    domainId, document.TYPE_CONTEST, tid,
                    tsdoc.uid, tsdoc.rev, { journal, ...stats },
                ),
            );
        }
    }
    return await Promise.all(tasks);
}

export async function unlockScoreboard(domainId: string, tid: ObjectId) {
    const tdoc = await document.get(domainId, document.TYPE_CONTEST, tid);
    if (!tdoc.lockAt || tdoc.unlocked) return;
    await edit(domainId, tid, { unlocked: true });
    await recalcStatus(domainId, tid);
}

export function canViewHiddenScoreboard(this: { user: User }, tdoc: Tdoc) {
    if (this.user.own(tdoc)) return true;
    if (tdoc.rule === 'homework') return this.user.hasPerm(PERM.PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD);
    return this.user.hasPerm(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
}

export function canShowRecord(this: { user: User }, tdoc: Tdoc, allowPermOverride = true) {
    if (RULES[tdoc.rule].showRecord(tdoc, new Date())) return true;
    if (allowPermOverride && canViewHiddenScoreboard.call(this, tdoc)) return true;
    return false;
}

export function canShowSelfRecord(this: { user: User }, tdoc: Tdoc, allowPermOverride = true) {
    if (RULES[tdoc.rule].showSelfRecord(tdoc, new Date())) return true;
    if (allowPermOverride && canViewHiddenScoreboard.call(this, tdoc)) return true;
    return false;
}

export function canShowScoreboard(this: { user: User }, tdoc: Tdoc, allowPermOverride = true) {
    if (RULES[tdoc.rule].showScoreboard(tdoc, new Date())) return true;
    if (allowPermOverride && canViewHiddenScoreboard.call(this, tdoc)) return true;
    return false;
}

export async function getScoreboard(
    this: Handler, domainId: string, tid: ObjectId, config: ScoreboardConfig,
): Promise<[Tdoc, ScoreboardRow[], BaseUserDict, ProblemDict]> {
    const tdoc = await get(domainId, tid);
    if (!canShowScoreboard.call(this, tdoc)) throw new ContestScoreboardHiddenError(tid);
    const tsdocsCursor = getMultiStatus(domainId, { docId: tid, attend: { $gt: 0 } }).sort(RULES[tdoc.rule].statusSort);
    const pdict = await problem.getList(domainId, tdoc.pids, true, true, problem.PROJECTION_CONTEST_DETAIL);
    const [rows, udict] = await RULES[tdoc.rule].scoreboard(
        config, this.translate.bind(this),
        tdoc, pdict, tsdocsCursor,
    );
    await bus.parallel('contest/scoreboard', tdoc, rows, udict, pdict);
    return [tdoc, rows, udict, pdict];
}

export function addClarification(
    domainId: string, tid: ObjectId, owner: number, content: string,
    ip: string, subject = 0,
) {
    return document.add(
        domainId, content, owner, document.TYPE_CONTEST_CLARIFICATION,
        null, document.TYPE_CONTEST, tid, { ip, subject },
    );
}

export function addClarificationReply(
    domainId: string, did: ObjectId, owner: number,
    content: string, ip: string,
) {
    return document.push(
        domainId, document.TYPE_CONTEST_CLARIFICATION, did,
        'reply', { content, owner, ip },
    );
}

export function getClarification(domainId: string, did: ObjectId) {
    return document.get(domainId, document.TYPE_CONTEST_CLARIFICATION, did);
}

export function getMultiClarification(domainId: string, tid: ObjectId, owner?: number) {
    return document.getMulti(
        domainId, document.TYPE_CONTEST_CLARIFICATION,
        { parentType: document.TYPE_CONTEST, parentId: tid, ...(typeof owner === 'number' ? { owner: { $in: [owner, 0] } } : {}) },
    ).sort('_id', -1).toArray();
}

export function applyProjection(tdoc: Tdoc, rdoc: RecordDoc, udoc: User) {
    if (!RULES[tdoc.rule]) return rdoc;
    return RULES[tdoc.rule].applyProjection(tdoc, rdoc, udoc);
}

export const statusText = (tdoc: Tdoc, tsdoc?: ContestStatusDoc): string => (
    isNew(tdoc)
        ? 'New'
        : isUpcoming(tdoc)
            ? 'Ready (☆▽☆)'
            : isOngoing(tdoc, tsdoc)
                ? 'Live...'
                : 'Done');

export function addPrintTask(domainId: string, tid: ObjectId, uid: number, name: string, content: string) {
    return document.add(domainId, content, uid, document.TYPE_CONTEST_PRINT, null, document.TYPE_CONTEST, tid, {
        title: name,
        status: PrintTaskStatus.pending,
    });
}

export async function updatePrintTask(domainId: string, tid: ObjectId, taskId: ObjectId, $set: Partial<ContestPrintDoc>) {
    const res = await document.coll.updateOne({
        domainId, docType: document.TYPE_CONTEST_PRINT,
        docId: taskId, parentType: document.TYPE_CONTEST, parentId: tid,
    }, { $set });
    return !!res.modifiedCount;
}

export function allocatePrintTask(domainId: string, tid: ObjectId) {
    return document.coll.findOneAndUpdate({
        domainId, docType: document.TYPE_CONTEST_PRINT,
        parentType: document.TYPE_CONTEST, parentId: tid,
        status: PrintTaskStatus.pending,
    }, {
        $set: {
            status: PrintTaskStatus.printing,
        },
    }, { returnDocument: 'after' });
}

export function getMultiPrintTask(domainId: string, tid: ObjectId, query = {}) {
    return document.getMulti(domainId, document.TYPE_CONTEST_PRINT, { parentType: document.TYPE_CONTEST, parentId: tid, ...query })
        .sort({ _id: 1 });
}

export async function apply(ctx: Context) {
    ctx.on('contest/balloon', (domainId, tid, bdoc) => {
        if (!bdoc.first) return;
        (async () => {
            const tsdocs = await getMultiStatus(domainId, { docId: tid, subscribe: 1 }).toArray();
            const uids = Array.from<number>(new Set(tsdocs.map((tsdoc) => tsdoc.uid)));
            const [team, tdoc, pdoc] = await Promise.all([
                UserModel.getById(domainId, bdoc.uid),
                get(domainId, tid),
                ProblemModel.get(domainId, bdoc.pid),
            ]);
            if (!pdoc) return;
            await MessageModel.send(1, uids, JSON.stringify({
                message: 'First Blood Notice\n{0} solved problem {1} ({2})',
                avatar: avatar(team.avatar),
                params: [team.uname, getAlphabeticId(tdoc.pids.indexOf(bdoc.pid)), pdoc.title],
            }), MessageModel.FLAG_I18N);
        })().catch((e) => ctx.logger.error(e));
    });
    await ctx.db.ensureIndexes(
        collBalloon,
        { key: { domainId: 1, tid: 1, pid: 1, uid: 1 }, unique: true, name: 'basic' },
        { key: { domainId: 1, tid: 1, pid: 1 }, unique: true, name: 'first', partialFilterExpression: { first: true } },
    );
}

global.Hydro.model.contest = {
    apply,

    RULES,
    PrintTaskStatus,
    buildContestRule,
    add,
    getListStatus,
    getMultiStatus,
    attend,
    cancelAttend,
    edit,
    del,
    get,
    getRelated,
    updateStatus,
    getStatus,
    count,
    countStatus,
    getMulti,
    setStatus,
    getAndListStatus,
    recalcStatus,
    unlockScoreboard,
    getBalloon,
    addBalloon,
    getMultiBalloon,
    updateBalloon,
    canShowRecord,
    canShowSelfRecord,
    canShowScoreboard,
    canViewHiddenScoreboard,
    getScoreboard,
    addClarification,
    addClarificationReply,
    getClarification,
    getMultiClarification,
    isNew,
    isUpcoming,
    isNotStarted,
    isOngoing,
    isDone,
    isLocked,
    isExtended,
    applyProjection,
    statusText,
    addPrintTask,
    updatePrintTask,
    allocatePrintTask,
    getMultiPrintTask,
};
