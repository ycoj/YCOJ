import { sumBy } from 'lodash';
import { ObjectId } from 'mongodb';
import { Counter, formatSeconds, getAlphabeticId } from '@hydrooj/utils/lib/utils';
import type { ContestRules, ScoreboardNode, ScoreboardRow, SubtaskResult } from '../../interface';
import db from '../../service/db';
import { STATUS, STATUS_SHORT_TEXTS } from '../builtin';
import * as document from '../document';
import problem from '../problem';
import UserModel from '../user';
import { buildContestRule, isDone, isLocked } from './common';

interface AcmJournal {
    rid: ObjectId;
    pid: number;
    score: number;
    status: number;
    time: number;
}
interface AcmDetail extends AcmJournal {
    naccept?: number;
    npending?: number;
    penalty: number;
    real: number;
}

const acm = buildContestRule({
    TEXT: 'XCPC',
    check: () => { },
    statusSort: { accept: -1, time: 1 },
    submitAfterAccept: false,
    showScoreboard: (tdoc, now) => now > tdoc.beginAt,
    showSelfRecord: () => true,
    showRecord: (tdoc, now) => now > tdoc.endAt && !isLocked(tdoc),
    stat(tdoc, journal: AcmJournal[]) {
        const naccept = Counter<number>();
        const npending = Counter<number>();
        const display: Record<number, AcmDetail> = {};
        const detail: Record<number, AcmDetail> = {};
        let accept = 0;
        let time = 0;
        const lockAt = isLocked(tdoc) ? tdoc.lockAt : null;
        for (const j of journal) {
            if (!tdoc.pids.includes(j.pid)) continue;
            if (!this.submitAfterAccept && display[j.pid]?.status === STATUS.STATUS_ACCEPTED) continue;
            if (![STATUS.STATUS_ACCEPTED, STATUS.STATUS_COMPILE_ERROR, STATUS.STATUS_FORMAT_ERROR, STATUS.STATUS_CANCELED].includes(j.status)) {
                naccept[j.pid]++;
            }
            const real = Math.floor((j.rid.getTimestamp().getTime() - tdoc.beginAt.getTime()) / 1000);
            const penalty = 20 * 60 * naccept[j.pid];
            detail[j.pid] = {
                ...j, naccept: naccept[j.pid], time: real + penalty, real, penalty,
            };
            if (lockAt && j.rid.getTimestamp() > lockAt) {
                npending[j.pid]++;
                // FIXME this is tricky
                // @ts-ignore
                display[j.pid] ||= {};
                display[j.pid].npending = npending[j.pid];
                continue;
            }
            display[j.pid] = detail[j.pid];
        }
        for (const d of Object.values(display).filter((i) => i.status === STATUS.STATUS_ACCEPTED)) {
            accept++;
            time += d.time;
        }
        return {
            accept, time, detail, display,
        };
    },
    async scoreboardHeader(config, _, tdoc, pdict) {
        const columns: ScoreboardRow = [
            { type: 'rank', value: '#' },
            { type: 'user', value: _('User') },
        ];
        if (config.isExport && config.showDisplayName) {
            columns.push({ type: 'email', value: _('Email') });
            columns.push({ type: 'string', value: _('School') });
            columns.push({ type: 'string', value: _('Name') });
            columns.push({ type: 'string', value: _('Student ID') });
        }
        columns.push({ type: 'solved', value: `${_('Solved')}\n${_('Total Time')}` });
        for (let i = 1; i <= tdoc.pids.length; i++) {
            const pid = tdoc.pids[i - 1];
            pdict[pid].nAccept = pdict[pid].nSubmit = 0;
            if (config.isExport) {
                columns.push(
                    {
                        type: 'string',
                        value: '#{0} {1}'.format(i, pdict[pid].title),
                    },
                    {
                        type: 'time',
                        value: '#{0} {1}'.format(i, _('Penalty (Minutes)')),
                    },
                );
            } else {
                columns.push({
                    type: 'problem',
                    value: getAlphabeticId(i - 1),
                    raw: pid,
                });
            }
        }
        return columns;
    },
    async scoreboardRow(config, _, tdoc, pdict, udoc, rank, tsdoc, meta) {
        const row: ScoreboardRow = [
            { type: 'rank', value: rank.toString() },
            { type: 'user', value: udoc.uname, raw: tsdoc.uid },
        ];
        if (config.isExport && config.showDisplayName) {
            row.push({ type: 'email', value: udoc.mail });
            row.push({ type: 'string', value: udoc.school || '' });
            row.push({ type: 'string', value: udoc.displayName || '' });
            row.push({ type: 'string', value: udoc.studentId || '' });
        }
        row.push({
            type: 'time',
            value: `${tsdoc.accept || 0}\n${formatSeconds(tsdoc.time || 0.0, false)}`,
            hover: formatSeconds(tsdoc.time || 0.0),
        });
        const accepted = {};
        for (const s of tsdoc.journal || []) {
            if (!pdict[s.pid]) continue;
            if (config.lockAt && s.rid.getTimestamp() > config.lockAt) continue;
            pdict[s.pid].nSubmit++;
            if (s.status === STATUS.STATUS_ACCEPTED && !accepted[s.pid]) {
                pdict[s.pid].nAccept++;
                accepted[s.pid] = true;
            }
        }
        const tsddict = (config.lockAt ? tsdoc.display : tsdoc.detail) || {};
        for (const pid of tdoc.pids) {
            const doc = tsddict[pid] || {} as Partial<AcmDetail>;
            const accept = doc.status === STATUS.STATUS_ACCEPTED;
            const colTime = accept ? formatSeconds(doc.real, false).toString() : '';
            const colPenalty = doc.rid ? Math.ceil(doc.penalty / 60).toString() : '';
            if (config.isExport) {
                row.push(
                    { type: 'string', value: colTime },
                    { type: 'string', value: colPenalty },
                );
            } else {
                let value = '';
                if (doc.rid) value = `-${doc.naccept}`;
                if (accept) value = `${doc.naccept ? `+${doc.naccept}` : '<span class="icon icon-check"></span>'}\n${colTime}`;
                else if (doc.npending) value += `${value ? ' ' : ''}<span style="color:orange">+${doc.npending}</span>`;
                row.push({
                    type: 'record',
                    score: accept ? 100 : 0,
                    value,
                    hover: accept ? formatSeconds(doc.time) : '',
                    raw: doc.rid,
                    first: accept && doc.rid.getTimestamp().getTime() === meta?.first?.[pid]
                        ? true
                        : undefined,
                    style: accept && doc.rid.getTimestamp().getTime() === meta?.first?.[pid]
                        ? 'background-color: rgb(217, 240, 199);'
                        : undefined,
                });
            }
        }
        return row;
    },
    async scoreboard(config, _, tdoc, pdict, cursor) {
        const rankedTsdocs = await db.ranked(cursor, (a, b) => (a.score || 0) === (b.score || 0) && (a.time || 0) === (b.time || 0));
        const uids = rankedTsdocs.map(([, tsdoc]) => tsdoc.uid);
        const udict = await UserModel.getListForRender(tdoc.domainId, uids, config.showDisplayName ? ['displayName'] : []);
        // Find first accept
        const first = {};
        const data = await document.collStatus.aggregate([
            {
                $match: {
                    domainId: tdoc.domainId,
                    docType: document.TYPE_CONTEST,
                    docId: tdoc.docId,
                    attend: { $gt: 0 },
                    accept: { $gte: 1 },
                },
            },
            { $project: { r: { $objectToArray: '$detail' } } },
            { $unwind: '$r' },
            { $match: { 'r.v.status': STATUS.STATUS_ACCEPTED } },
            { $group: { _id: '$r.v.pid', first: { $min: '$r.v.rid' } } },
        ]).toArray() as any[];
        for (const t of data) first[t._id] = t.first.getTimestamp().getTime();

        const columns = await this.scoreboardHeader(config, _, tdoc, pdict);
        const rows: ScoreboardRow[] = [
            columns,
            ...await Promise.all(rankedTsdocs.map(
                ([rank, tsdoc]) => this.scoreboardRow(
                    config, _, tdoc, pdict, udict[tsdoc.uid], rank, tsdoc, { first },
                ),
            )),
        ];
        return [rows, udict];
    },
    async ranked(tdoc, cursor) {
        return await db.ranked(cursor, (a, b) => a.accept === b.accept && a.time === b.time);
    },
    applyProjection(tdoc, rdoc) {
        if (isDone(tdoc)) return rdoc;
        delete rdoc.time;
        delete rdoc.memory;
        rdoc.testCases = [];
        rdoc.judgeTexts = [];
        delete rdoc.progress;
        delete rdoc.subtasks;
        delete rdoc.score;
        return rdoc;
    },
});

const oi = buildContestRule({
    TEXT: 'OI',
    check: () => { },
    submitAfterAccept: true,
    statusSort: { score: -1 },
    stat(tdoc, journal) {
        const npending = Counter();
        const detail = {};
        const display = {};
        let score = 0;

        const lockAt = isLocked(tdoc) ? tdoc.lockAt : null;
        for (const j of journal.filter((i) => tdoc.pids.includes(i.pid))) {
            if (lockAt && j.rid.getTimestamp() > lockAt) {
                npending[j.pid]++;
                display[j.pid] ||= {};
                display[j.pid].npending = npending[j.pid];
                continue;
            }
            if (!detail[j.pid] || detail[j.pid].score < j.score || this.submitAfterAccept) {
                detail[j.pid] = { ...j };
                display[j.pid] = { ...j };
            }
        }
        for (const i in display) {
            score += ((tdoc.score?.[i] || 100) * (display[i].score || 0)) / 100;
        }
        return { score, detail, display };
    },
    showScoreboard: (tdoc, now) => now > tdoc.endAt && !tdoc.keepScoreboardHidden,
    showSelfRecord: (tdoc, now) => now > tdoc.endAt && !tdoc.keepScoreboardHidden,
    showRecord: (tdoc, now) => now > tdoc.endAt && !tdoc.keepScoreboardHidden,
    async scoreboardHeader(config, _, tdoc, pdict) {
        const columns: ScoreboardNode[] = [
            { type: 'rank', value: '#' },
            { type: 'user', value: _('User') },
        ];
        if (config.isExport && config.showDisplayName) {
            columns.push({ type: 'email', value: _('Email') });
            columns.push({ type: 'string', value: _('School') });
            columns.push({ type: 'string', value: _('Name') });
            columns.push({ type: 'string', value: _('Student ID') });
        }
        columns.push({ type: 'total_score', value: _('Total Score') });
        for (let i = 1; i <= tdoc.pids.length; i++) {
            const pid = tdoc.pids[i - 1];
            pdict[pid].nAccept = pdict[pid].nSubmit = 0;
            if (config.isExport) {
                columns.push({
                    type: 'string',
                    value: '#{0} {1}'.format(i, pdict[tdoc.pids[i - 1]].title),
                });
            } else {
                columns.push({
                    type: 'problem',
                    value: getAlphabeticId(i - 1),
                    raw: tdoc.pids[i - 1],
                });
            }
        }
        return columns;
    },
    async scoreboardRow(config, _, tdoc, pdict, udoc, rank, tsdoc, meta) {
        const row: ScoreboardNode[] = [
            { type: 'rank', value: rank.toString() },
            { type: 'user', value: udoc.uname, raw: tsdoc.uid },
        ];
        const displayScore = (pid: number, score?: number) => {
            if (typeof score !== 'number') return '-';
            return score * ((tdoc.score?.[pid] || 100) / 100);
        };
        if (config.isExport && config.showDisplayName) {
            row.push({ type: 'email', value: udoc.mail });
            row.push({ type: 'string', value: udoc.school || '' });
            row.push({ type: 'string', value: udoc.displayName || '' });
            row.push({ type: 'string', value: udoc.studentId || '' });
        }
        row.push({ type: 'total_score', value: (tsdoc.score || 0).toString() });
        const accepted = {};
        for (const s of tsdoc.journal || []) {
            if (!pdict[s.pid]) continue;
            if (config.lockAt && s.rid.getTimestamp() > config.lockAt) continue;
            pdict[s.pid].nSubmit++;
            if (s.status === STATUS.STATUS_ACCEPTED && !accepted[s.pid]) {
                pdict[s.pid].nAccept++;
                accepted[s.pid] = true;
            }
        }
        const tsddict = ((config.lockAt && isLocked(tdoc, new Date())) ? tsdoc.display : tsdoc.detail) || {};
        const useRelativeTime = !!tdoc.duration;
        for (const pid of tdoc.pids) {
            const index = `${tsdoc.uid}/${tdoc.domainId}/${pid}`;

            const node: ScoreboardNode = (!config.isExport && !config.lockAt && isDone(tdoc)
                && meta?.psdict?.[index]?.rid
                && tsddict[pid]?.rid?.toHexString() !== meta?.psdict?.[index]?.rid?.toHexString()
                && meta?.psdict?.[index]?.rid?.getTimestamp() > tdoc.endAt)
                ? {
                    type: 'records',
                    value: '',
                    raw: [{
                        value: displayScore(pid, tsddict[pid]?.score),
                        raw: tsddict[pid]?.rid || null,
                        score: tsddict[pid]?.score,
                    }, {
                        value: displayScore(pid, meta?.psdict?.[index]?.score),
                        raw: meta?.psdict?.[index]?.rid ?? null,
                        score: meta?.psdict?.[index]?.score,
                    }],
                } : {
                    type: 'record',
                    value: `${displayScore(pid, tsddict[pid]?.score)}${tsddict[pid]?.npending
                        ? `<span style="color:orange">+${tsddict[pid]?.npending}</span>` : ''}`,
                    raw: tsddict[pid]?.rid || null,
                    score: tsddict[pid]?.score,
                };
            if (tsddict[pid]?.status === STATUS.STATUS_ACCEPTED) {
                const startAt = (useRelativeTime ? tsdoc.startAt || tdoc.beginAt : tdoc.beginAt).getTime();
                if (tsddict[pid].rid.getTimestamp().getTime() - startAt === meta?.first?.[pid]) {
                    node.first = true;
                    node.style = 'background-color: rgb(217, 240, 199);';
                }
            }
            row.push(node);
        }
        return row;
    },
    async scoreboard(config, _, tdoc, pdict, cursor) {
        const rankedTsdocs = await db.ranked(cursor, (a, b) => (a.score || 0) === (b.score || 0));
        const uids = rankedTsdocs.map(([, tsdoc]) => tsdoc.uid);
        const udict = await UserModel.getListForRender(tdoc.domainId, uids, config.showDisplayName ? ['displayName'] : []);
        const psdict = {};
        const first = {};
        const useRelativeTime = !!tdoc.duration;
        for (const [, tsdoc] of rankedTsdocs) {
            for (const [pid, detail] of Object.entries(tsdoc.detail || {})) {
                if (detail.status !== STATUS.STATUS_ACCEPTED) continue;
                const time = detail.rid.getTimestamp().getTime() - (useRelativeTime ? tsdoc.startAt || tdoc.beginAt : tdoc.beginAt).getTime();
                if (!first[pid] || first[pid] > time) first[pid] = time;
            }
        }

        if (isDone(tdoc)) {
            const psdocs = await Promise.all(
                tdoc.pids.map((pid) => problem.getMultiStatus(tdoc.domainId, { docId: pid, uid: { $in: uids } }).toArray()),
            );
            for (const tpsdoc of psdocs) {
                for (const psdoc of tpsdoc) {
                    psdict[`${psdoc.uid}/${psdoc.domainId}/${psdoc.docId}`] = psdoc;
                }
            }
        }
        const columns = await this.scoreboardHeader(config, _, tdoc, pdict);
        const rows: ScoreboardRow[] = [
            columns,
            ...await Promise.all(rankedTsdocs.map(
                ([rank, tsdoc]) => this.scoreboardRow(
                    config, _, tdoc, pdict, udict[tsdoc.uid], rank, tsdoc, { psdict, first },
                ),
            )),
        ];
        return [rows, udict];
    },
    async ranked(tdoc, cursor) {
        return await db.ranked(cursor, (a, b) => a.score === b.score);
    },
    applyProjection(tdoc, rdoc) {
        if (isDone(tdoc)) return rdoc;
        delete rdoc.status;
        rdoc.compilerTexts = [];
        rdoc.judgeTexts = [];
        delete rdoc.memory;
        delete rdoc.time;
        delete rdoc.score;
        rdoc.testCases = [];
        delete rdoc.subtasks;
        return rdoc;
    },
});

const ioi = buildContestRule({
    TEXT: 'IOI',
    submitAfterAccept: false,

    showRecord: (tdoc, now) => now > tdoc.endAt && !isLocked(tdoc),
    showSelfRecord: () => true,
    showScoreboard: (tdoc, now) => now > tdoc.beginAt,
    applyProjection(_, rdoc) {
        return rdoc;
    },
}, oi);

const strictioi = buildContestRule({
    TEXT: 'IOI(Strict)',
    submitAfterAccept: false,
    showRecord: (tdoc, now) => now > tdoc.endAt && !tdoc.keepScoreboardHidden,
    showSelfRecord: (tdoc) => !tdoc.keepScoreboardHidden || !isDone(tdoc),
    showScoreboard: (tdoc, now) => now > tdoc.endAt && !tdoc.keepScoreboardHidden,
    stat(tdoc, journal) {
        const detail = {};
        let score = 0;
        const subtasks: Record<number, Record<number, SubtaskResult>> = {};
        for (const j of journal.filter((i) => tdoc.pids.includes(i.pid))) {
            subtasks[j.pid] ||= {};
            for (const i in j.subtasks) {
                if (!subtasks[j.pid][i] || subtasks[j.pid][i].score < j.subtasks[i].score) subtasks[j.pid][i] = j.subtasks[i];
            }
            j.score = sumBy(Object.values(subtasks[j.pid]), 'score');
            j.status = Math.max(...Object.values(subtasks[j.pid]).map((i) => i.status));
            if (!detail[j.pid] || detail[j.pid].score < j.score) detail[j.pid] = { ...j, subtasks: subtasks[j.pid] };
        }
        for (const i in detail) score += ((tdoc.score?.[i] || 100) * (detail[i].score || 0)) / 100;
        return { score, detail };
    },
    async scoreboardRow(config, _, tdoc, pdict, udoc, rank, tsdoc, meta) {
        const tsddict = tsdoc.detail || {};
        const row: ScoreboardNode[] = [
            { type: 'rank', value: rank.toString() },
            { type: 'user', value: udoc.uname, raw: tsdoc.uid },
        ];
        if (config.isExport && config.showDisplayName) {
            row.push({ type: 'email', value: udoc.mail });
            row.push({ type: 'string', value: udoc.school || '' });
            row.push({ type: 'string', value: udoc.displayName || '' });
            row.push({ type: 'string', value: udoc.studentId || '' });
        }
        row.push({ type: 'total_score', value: (tsdoc.score || 0).toString() });
        const accepted = {};
        for (const s of tsdoc.journal || []) {
            if (!pdict[s.pid]) continue;
            pdict[s.pid].nSubmit++;
            if (s.status === STATUS.STATUS_ACCEPTED && !accepted[s.pid]) {
                pdict[s.pid].nAccept++;
                accepted[s.pid] = true;
            }
        }
        for (const pid of tdoc.pids) {
            const index = `${tsdoc.uid}/${tdoc.domainId}/${pid}`;
            const n: ScoreboardNode = (!config.isExport && !config.lockAt && isDone(tdoc)
                && meta?.psdict?.[index]?.rid
                && tsddict[pid]?.rid?.toHexString() !== meta?.psdict?.[index]?.rid?.toHexString()
                && meta?.psdict?.[index]?.rid?.getTimestamp() > tdoc.endAt)
                ? {
                    type: 'records',
                    value: '',
                    raw: [{
                        value: ((tsddict[pid]?.score || 0) * ((tdoc.score?.[pid] || 100) / 100)).toString() || '',
                        raw: tsddict[pid]?.rid || null,
                        score: tsddict[pid]?.score,
                    }, {
                        value: ((meta?.psdict?.[index]?.score || 0) * ((tdoc.score?.[pid] || 100) / 100)).toString() || '',
                        raw: meta?.psdict?.[index]?.rid ?? null,
                        score: meta?.psdict?.[index]?.score,
                    }],
                } : {
                    type: 'record',
                    value: ((tsddict[pid]?.score || 0) * ((tdoc.score?.[pid] || 100) / 100)).toString() || '',
                    raw: tsddict[pid]?.rid,
                    score: tsddict[pid]?.score,
                };
            n.hover = Object.values(tsddict[pid]?.subtasks || {}).map((i: SubtaskResult) => `${STATUS_SHORT_TEXTS[i.status]} ${i.score}`).join(',');
            if (tsddict[pid]?.status === STATUS.STATUS_ACCEPTED
                && tsddict[pid].rid.getTimestamp().getTime() - (tsdoc.startAt || tdoc.beginAt).getTime() === meta?.first?.[pid]) {
                n.first = true;
                n.style = 'background-color: rgb(217, 240, 199);';
            }
            row.push(n);
        }
        return row;
    },
}, ioi);

const ledo = buildContestRule({
    TEXT: 'Ledo',
    check: () => { },
    submitAfterAccept: false,
    showScoreboard: (tdoc, now) => now > tdoc.beginAt,
    showSelfRecord: () => true,
    showRecord: (tdoc, now) => now > tdoc.endAt,
    stat(tdoc, journal) {
        const ntry = Counter<number>();
        const detail = {};
        for (const j of journal.filter((i) => tdoc.pids.includes(i.pid))) {
            const vaild = ![STATUS.STATUS_COMPILE_ERROR, STATUS.STATUS_FORMAT_ERROR].includes(j.status);
            if (vaild) ntry[j.pid]++;
            const penaltyScore = vaild ? Math.round(Math.max(0.7, 0.95 ** (ntry[j.pid] - 1)) * j.score) : 0;
            if (!detail[j.pid] || detail[j.pid].penaltyScore < penaltyScore) {
                detail[j.pid] = {
                    ...j,
                    penaltyScore,
                    ntry: Math.max(0, ntry[j.pid] - 1),
                };
            }
        }
        let score = 0;
        let originalScore = 0;
        for (const pid of tdoc.pids) {
            if (!detail[pid]) continue;
            const rate = (tdoc.score?.[pid] || 100) / 100;
            score += detail[pid].penaltyScore * rate;
            originalScore += detail[pid].score * rate;
        }
        return {
            score, originalScore, detail,
        };
    },
    async scoreboardRow(config, _, tdoc, pdict, udoc, rank, tsdoc, meta) {
        const tsddict = tsdoc.detail || {};
        const row: ScoreboardRow = [
            { type: 'rank', value: rank.toString() },
            { type: 'user', value: udoc.uname, raw: tsdoc.uid },
        ];
        if (config.isExport && config.showDisplayName) {
            row.push({ type: 'email', value: udoc.mail });
            row.push({ type: 'string', value: udoc.school || '' });
            row.push({ type: 'string', value: udoc.displayName || '' });
            row.push({ type: 'string', value: udoc.studentId || '' });
        }
        row.push({
            type: 'total_score',
            value: (tsdoc.score || 0).toString(),
            hover: tsdoc.score !== tsdoc.originalScore ? _('Original score: {0}').format(tsdoc.originalScore) : '',
        });
        const accepted = {};
        for (const s of tsdoc.journal || []) {
            if (!pdict[s.pid]) continue;
            pdict[s.pid].nSubmit++;
            if (s.status === STATUS.STATUS_ACCEPTED && !accepted[s.pid]) {
                pdict[s.pid].nAccept++;
                accepted[s.pid] = true;
            }
        }
        for (const pid of tdoc.pids) {
            row.push({
                type: 'record',
                value: ((tsddict[pid]?.penaltyScore || 0) * ((tdoc.score?.[pid] || 100) / 100)).toString(),
                hover: tsddict[pid]?.ntry ? `-${tsddict[pid].ntry} (${Math.round(Math.max(0.7, 0.95 ** tsddict[pid].ntry) * 100)}%)` : '',
                raw: tsddict[pid]?.rid,
                score: tsddict[pid]?.score,
                first: tsddict[pid]?.status === STATUS.STATUS_ACCEPTED
                    && tsddict[pid].rid.getTimestamp().getTime() - (tsdoc.startAt || tdoc.beginAt).getTime() === meta?.first?.[pid]
                    ? true
                    : undefined,
                style: tsddict[pid]?.status === STATUS.STATUS_ACCEPTED
                    && tsddict[pid].rid.getTimestamp().getTime() - (tsdoc.startAt || tdoc.beginAt).getTime() === meta?.first?.[pid]
                    ? 'background-color: rgb(217, 240, 199);'
                    : undefined,
            });
        }
        return row;
    },
    applyProjection(_, rdoc) {
        return rdoc;
    },
}, oi);

const homework = buildContestRule({
    TEXT: 'Assignment',
    hidden: true,
    features: ['scoreboard', 'download'],
    check: () => { },
    submitAfterAccept: false,
    statusSort: { penaltyScore: -1, time: 1 },
    stat: (tdoc, journal) => {
        const effective = {};
        for (const j of journal) {
            if (tdoc.pids.includes(j.pid)) effective[j.pid] = j;
        }
        function time(jdoc) {
            const real = (jdoc.rid.getTimestamp().getTime() - tdoc.beginAt.getTime()) / 1000;
            return Math.floor(real);
        }

        function penaltyScore(jdoc) {
            const rate = (tdoc.score?.[jdoc.pid] || 100) / 100;
            const exceedSeconds = Math.floor(
                (jdoc.rid.getTimestamp().getTime() - tdoc.penaltySince.getTime()) / 1000,
            );
            if (exceedSeconds < 0) return rate * jdoc.score;
            let coefficient = 1;
            const keys = Object.keys(tdoc.penaltyRules).map(Number.parseFloat).sort((a, b) => a - b);
            for (const i of keys) {
                if (i * 3600 <= exceedSeconds) coefficient = tdoc.penaltyRules[i];
                else break;
            }
            return rate * jdoc.score * coefficient;
        }
        const detail = [];
        for (const j in effective) {
            effective[j].penaltyScore = penaltyScore(effective[j]);
            effective[j].time = time(effective[j]);
            detail.push(effective[j]);
        }
        return {
            score: sumBy(detail, 'score'),
            penaltyScore: sumBy(detail, 'penaltyScore'),
            time: Math.sum(detail.map((d) => d.time)),
            detail: effective,
        };
    },
    showScoreboard: () => true,
    showSelfRecord: () => true,
    showRecord: (tdoc, now) => now > tdoc.endAt,
    async scoreboardHeader(config, _, tdoc, pdict) {
        const columns: ScoreboardNode[] = [
            { type: 'rank', value: _('Rank') },
            { type: 'user', value: _('User') },
        ];
        if (config.isExport && config.showDisplayName) {
            columns.push({ type: 'email', value: _('Email') });
            columns.push({ type: 'string', value: _('School') });
            columns.push({ type: 'string', value: _('Name') });
            columns.push({ type: 'string', value: _('Student ID') });
        }
        columns.push({ type: 'total_score', value: _('Score') });
        if (config.isExport) {
            columns.push({ type: 'string', value: _('Original Score') });
        }
        columns.push({ type: 'time', value: _('Total Time') });
        for (let i = 1; i <= tdoc.pids.length; i++) {
            const pid = tdoc.pids[i - 1];
            pdict[pid].nAccept = pdict[pid].nSubmit = 0;
            if (config.isExport) {
                columns.push(
                    {
                        type: 'string',
                        value: '#{0} {1}'.format(i, pdict[pid].title),
                    },
                    {
                        type: 'string',
                        value: '#{0} {1}'.format(i, _('Original Score')),
                    },
                    {
                        type: 'time',
                        value: '#{0} {1}'.format(i, _('Time (Seconds)')),
                    },
                );
            } else {
                columns.push({
                    type: 'problem',
                    value: getAlphabeticId(i - 1),
                    raw: pid,
                });
            }
        }
        return columns;
    },
    async scoreboardRow(config, _, tdoc, pdict, udoc, rank, tsdoc) {
        const tsddict = tsdoc.detail || {};
        const row: ScoreboardRow = [
            { type: 'rank', value: rank.toString() },
            {
                type: 'user',
                value: udoc.uname,
                raw: tsdoc.uid,
            },
        ];
        if (config.isExport && config.showDisplayName) {
            row.push({ type: 'email', value: udoc.mail });
            row.push({ type: 'string', value: udoc.school || '' });
            row.push({ type: 'string', value: udoc.displayName || '' });
            row.push({ type: 'string', value: udoc.studentId || '' });
        }
        row.push({ type: 'string', value: (tsdoc.penaltyScore || 0).toString() });
        if (config.isExport) {
            row.push({ type: 'string', value: (tsdoc.score || 0).toString() });
        }
        row.push({ type: 'time', value: formatSeconds(tsdoc.time || 0, false), raw: tsdoc.time });
        const accepted = {};
        for (const s of tsdoc.journal || []) {
            if (!pdict[s.pid]) continue;
            pdict[s.pid].nSubmit++;
            if (s.status === STATUS.STATUS_ACCEPTED && !accepted[s.pid]) {
                pdict[s.pid].nAccept++;
                accepted[s.pid] = true;
            }
        }
        for (const pid of tdoc.pids) {
            const rid = tsddict[pid]?.rid;
            const colScore = (tsddict[pid]?.penaltyScore ?? '').toString();
            const colOriginalScore = (tsddict[pid]?.score ?? '').toString();
            const colTime = (tsddict[pid]?.time || '').toString();
            const colTimeStr = colTime ? formatSeconds(colTime, false) : '';
            if (config.isExport) {
                row.push(
                    { type: 'string', value: colScore },
                    { type: 'string', value: colOriginalScore },
                    { type: 'time', value: colTime },
                );
            } else {
                row.push({
                    type: 'record',
                    score: tsddict[pid]?.score,
                    value: colScore === colOriginalScore
                        ? '{0}\n{1}'.format(colScore, colTimeStr)
                        : '{0} / {1}\n{2}'.format(colScore, colOriginalScore, colTimeStr),
                    raw: rid,
                });
            }
        }
        return row;
    },
    async scoreboard(config, _, tdoc, pdict, cursor) {
        const rankedTsdocs = await db.ranked(cursor, (a, b) => a.score === b.score);
        const uids = rankedTsdocs.map(([, tsdoc]) => tsdoc.uid);
        const udict = await UserModel.getListForRender(tdoc.domainId, uids, config.showDisplayName ? ['displayName'] : []);
        const columns = await this.scoreboardHeader(config, _, tdoc, pdict);
        const rows: ScoreboardRow[] = [
            columns,
            ...await Promise.all(rankedTsdocs.map(
                ([rank, tsdoc]) => this.scoreboardRow(config, _, tdoc, pdict, udict[tsdoc.uid], rank, tsdoc),
            )),
        ];
        return [rows, udict];
    },
    async ranked(tdoc, cursor) {
        return await db.ranked(cursor, (a, b) => a.score === b.score);
    },
});

export const RULES: ContestRules = { acm, oi, homework, ioi, ledo, strictioi };
