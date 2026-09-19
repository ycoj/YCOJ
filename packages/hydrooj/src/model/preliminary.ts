import { Filter, ObjectId } from 'mongodb';
import {
    PreliminaryAttemptNotFoundError, PreliminaryPaperNotFoundError, PreliminaryPaperNotPublishedError,
    ValidationError,
} from '../error';
import type {
    PreliminaryAttemptDoc, PreliminaryPaperDoc, PreliminaryProgrammingAnswer, PreliminaryQuestionResult, RecordDoc,
} from '../interface';
import {
    normalizePreliminaryAnswers, normalizePreliminaryDefinition, preliminaryTotalScore, scorePreliminaryAnswers,
} from '../lib/preliminary';
import * as document from './document';
import problem from './problem';
import user from './user';
import RecordModel from './record';
import task from './task';
import db from '../service/db';

const PAPER = document.TYPE_PRELIMINARY_PAPER;
const REVISION = document.TYPE_PRELIMINARY_REVISION;
const ATTEMPT = document.TYPE_PRELIMINARY_ATTEMPT;
const MAX_PROGRAMMING_SUBMISSIONS = 30;
const RESERVATION_STALE_MS = 15 * 60 * 1000;

async function releaseReservation(domainId: string, paperId: ObjectId, reservation: string) {
    const parts = reservation.split('|');
    const counterPath = parts[0];
    const tokenPath = parts[1];
    if (!counterPath || !tokenPath) return;
    await document.coll.updateOne(
        { domainId, docType: PAPER, docId: paperId, [tokenPath]: true },
        { $inc: { [counterPath]: -1 }, $unset: { [tokenPath]: '' } },
    );
}

export async function get(domainId: string, paperId: ObjectId) {
    const paper = await document.get(domainId, PAPER, paperId);
    if (!paper) throw new PreliminaryPaperNotFoundError(domainId, paperId);
    return paper;
}

export const getMulti = (domainId: string, query: Filter<PreliminaryPaperDoc> = {}) =>
    document.getMulti(domainId, PAPER, query).sort({ _id: -1 });

export async function add(
    domainId: string,
    definitionInput: unknown,
    owner: number,
    publish = false,
) {
    const definition = normalizePreliminaryDefinition(definitionInput, publish);
    const now = new Date();
    const paperId = await document.add(domainId, definition.content, owner, PAPER, null, null, null, {
        ...definition,
        published: false,
        revision: 0,
        nAttempt: 0,
        updatedAt: now,
    });
    // eslint-disable-next-line ts/no-use-before-define
    if (publish) await edit(domainId, paperId, definition, true);
    return paperId;
}

export async function edit(
    domainId: string,
    paperId: ObjectId,
    definitionInput: unknown,
    publish: boolean,
) {
    const paper = await get(domainId, paperId);
    const definition = normalizePreliminaryDefinition(definitionInput, publish);
    const updatedAt = new Date();
    if (!publish) {
        return await document.set(domainId, PAPER, paperId, {
            ...definition,
            published: false,
            updatedAt,
        });
    }

    const revision = paper.revision + 1;
    const revisionId = await document.add(
        domainId, definition.content, paper.owner, REVISION, null, PAPER, paperId,
        {
            ...definition,
            paperId,
            revision,
            createdAt: updatedAt,
        },
    );
    const updated = await document.coll.findOneAndUpdate(
        { domainId, docType: PAPER, docId: paperId, revision: paper.revision },
        {
            $set: {
                ...definition,
                published: true,
                revision,
                activeRevisionId: revisionId,
                updatedAt,
            },
        },
        { returnDocument: 'after' },
    ) as PreliminaryPaperDoc;
    if (!updated) {
        await document.deleteOne(domainId, REVISION, revisionId);
        throw new ValidationError('revision', null, 'The paper changed while it was being saved. Reload and try again.');
    }
    return updated;
}

export async function getRevision(domainId: string, paperId: ObjectId, revision: number) {
    return await document.getMulti(domainId, REVISION, { parentId: paperId, revision }).limit(1).next();
}

export async function getRevisionById(domainId: string, revisionId: ObjectId) {
    return await document.get(domainId, REVISION, revisionId);
}

export async function submit(
    domainId: string,
    paperId: ObjectId,
    revisionNumber: number,
    owner: number,
    answerInput: unknown,
    programmingInput: unknown = {},
) {
    const paper = await get(domainId, paperId);
    if (!paper.published) throw new PreliminaryPaperNotPublishedError(paperId);
    const revision = await getRevision(domainId, paperId, revisionNumber);
    if (!revision) throw new ValidationError('revision', null, 'This paper revision is no longer available.');
    const answers = normalizePreliminaryAnswers(revision, answerInput);
    const graded = scorePreliminaryAnswers(revision, answers);
    const rawProgrammingAnswers = (programmingInput && typeof programmingInput === 'object' && !Array.isArray(programmingInput))
        ? programmingInput as Record<string, PreliminaryProgrammingAnswer> : {};
    const programmingQuestions = new Map(revision.sections.flatMap((section) => section.questions)
        .filter((question) => question.type === 'programming').map((question) => [question.id, question]));
    for (const questionId of Object.keys(rawProgrammingAnswers)) {
        if (!programmingQuestions.has(questionId)) throw new ValidationError('programmingAnswers', null, 'Contains an invalid programming question');
    }
    const programmingAnswers: Record<string, PreliminaryProgrammingAnswer> = {};
    const reservedCounterPaths: string[] = [];
    const submittingUser = await user.getById(domainId, owner);
    const staleBefore = new Date(Date.now() - RESERVATION_STALE_MS);
    const staleReservations = await document.coll.find({
        domainId, docType: ATTEMPT, parentType: PAPER, parentId: paperId,
        status: 'reserving', submittedAt: { $lt: staleBefore },
    }).toArray();
    for (const stale of staleReservations) {
        const claimed = await document.coll.findOneAndUpdate(
            { domainId, docType: ATTEMPT, docId: stale.docId, status: 'reserving', submittedAt: { $lt: staleBefore } },
            { $set: { status: 'cleanup' } }, { returnDocument: 'after' },
        );
        if (!claimed) continue;
        const paths = Array.isArray((stale as any).reservationPaths) ? (stale as any).reservationPaths as string[] : [];
        for (const path of paths) await releaseReservation(domainId, paperId, path);
        await document.coll.deleteOne({ domainId, docType: ATTEMPT, docId: stale.docId, status: 'cleanup' });
    }
    const submittedAt = new Date();
    const provisionalAttemptId = new ObjectId();
    const session = db.client.startSession();
    try {
        await session.withTransaction(async () => {
            await document.coll.insertOne({ _id: provisionalAttemptId, content: '', owner, domainId, docType: ATTEMPT, docId: provisionalAttemptId, parentType: PAPER, parentId: paperId, paperId, revisionId: revision.docId, revision: revision.revision, answers, programmingAnswers: {}, ...graded, status: 'reserving', submittedAt, reservationPaths: [] } as any, { session });
            for (const section of revision.sections) for (const question of section.questions) {
                if (question.type !== 'programming') continue;
                const answer = rawProgrammingAnswers[question.id];
                if (!answer || typeof answer.code !== 'string' || typeof answer.lang !== 'string' || !answer.code.trim()) continue;
                const pdoc = await problem.get(domainId, question.pid);
                if (!pdoc || typeof pdoc.config !== 'object' || ['objective', 'submit_answer'].includes(pdoc.config.type)) throw new ValidationError('programmingAnswers', null, 'Referenced problem is not programmable');
                if (!submittingUser || !problem.canViewBy(pdoc, submittingUser)) throw new ValidationError('programmingAnswers', null, 'Referenced problem is not available');
                const allowedLanguages = question.languages.length ? question.languages : (Array.isArray((pdoc.config as any).langs) ? (pdoc.config as any).langs : []);
                if (allowedLanguages.length && !allowedLanguages.includes(answer.lang)) throw new ValidationError('programmingAnswers', null, 'Language is not allowed for this question');
                const counterKey = Buffer.from(`${owner}:${revision.docId.toHexString()}:${question.id}`).toString('base64url');
                const counterPath = `programmingSubmissionCounts.${counterKey}`;
                const tokenPath = `programmingReservationTokens.${counterKey}.${provisionalAttemptId.toHexString()}`;
                const reserved = await document.coll.findOneAndUpdate({ domainId, docType: PAPER, docId: paperId, published: true, $expr: { $lt: [{ $ifNull: [`$${counterPath}`, 0] }, MAX_PROGRAMMING_SUBMISSIONS] } }, { $inc: { [counterPath]: 1 }, $set: { [tokenPath]: true } }, { returnDocument: 'after', session });
                if (!reserved) throw new ValidationError('programmingAnswers', null, 'This programming question has reached its submission limit');
                const reservation = `${counterPath}|${tokenPath}`;
                reservedCounterPaths.push(reservation);
                await document.coll.updateOne({ domainId, docType: ATTEMPT, docId: provisionalAttemptId, status: 'reserving' }, { $push: { reservationPaths: reservation }, $set: { [`programmingAnswers.${question.id}`]: answer } } as any, { session });
                programmingAnswers[question.id] = answer;
            }
        });
    } finally {
        await session.endSession();
    }

    let attemptId: ObjectId;
    let attempt: PreliminaryAttemptDoc;
    let claimed = false;
    try {
        const currentPaper = await document.coll.findOne(
            { domainId, docType: PAPER, docId: paperId, published: true },
        );
        if (!currentPaper) throw new PreliminaryPaperNotPublishedError(paperId);

        attemptId = provisionalAttemptId;
        await document.coll.updateOne(
            { domainId, docType: ATTEMPT, docId: attemptId, status: 'reserving' },
            { $set: { programmingAnswers }, $unset: { reservationPaths: '' } },
        );

        const claimedPaper = await document.coll.findOneAndUpdate(
                { domainId, docType: PAPER, docId: paperId, published: true },
                { $inc: { nAttempt: 1 } },
                { returnDocument: 'after' },
            ) as PreliminaryPaperDoc;

        if (!claimedPaper) throw new PreliminaryPaperNotPublishedError(paperId);
        claimed = true;
        for (const section of revision.sections) for (const question of section.questions) {
            if (question.type !== 'programming') continue;
            const answer = programmingAnswers[question.id];
            if (!answer?.code?.trim()) continue;
            const rid = await (await import('./record')).default.add(
                domainId, question.pid, owner, answer.lang, answer.code, true,
                { type: 'judge', preliminary: { attemptId, questionId: question.id } },
            );
            // Bind only while the result is still pending and unclaimed. A judge
            // callback may complete it before this write; then this is a no-op.
            await document.coll.updateOne(
                {
                    domainId, docType: ATTEMPT, docId: attemptId,
                    results: { $elemMatch: { questionId: question.id, status: 'pending', rid: { $exists: false } } },
                },
                { $set: { 'results.$.rid': rid, 'results.$.lang': answer.lang, 'results.$.status': 'pending' } },
            );
        }

        await document.coll.updateOne(
            { domainId, docType: ATTEMPT, docId: attemptId, status: 'reserving' },
            { $set: { status: Object.keys(programmingAnswers).length ? 'pending' : 'completed' } },
        );

        attempt = await document.get(domainId, ATTEMPT, attemptId);
        return attempt;
    } catch (error) {
        if (attemptId || provisionalAttemptId) {
            const cleanupAttemptId = attemptId || provisionalAttemptId;
            const claimedCleanup = await document.coll.findOneAndUpdate(
                { domainId, docType: ATTEMPT, docId: cleanupAttemptId, status: { $in: ['reserving', 'pending', 'completed'] } },
                { $set: { status: 'cleanup' } }, { returnDocument: 'after' },
            );
            if (!claimedCleanup) throw error;
            const records = await RecordModel.coll.find({ domainId, 'preliminary.attemptId': cleanupAttemptId }).project({ _id: 1 }).toArray();
            if (records.length) await task.deleteMany({ rid: { $in: records.map((record) => record._id) } });
            await RecordModel.coll.deleteMany({ domainId, 'preliminary.attemptId': cleanupAttemptId });
            await document.coll.deleteOne({ domainId, docType: ATTEMPT, docId: cleanupAttemptId, status: 'cleanup' });
            if (claimed) await document.coll.updateOne(
                { domainId, docType: PAPER, docId: paperId },
                { $inc: { nAttempt: -1 } },
            );
        }
        for (const path of reservedCounterPaths) await releaseReservation(domainId, paperId, path);
        throw error;
    }
}

export async function updateProgrammingResult(domainId: string, rdoc: RecordDoc) {
    if (!rdoc.preliminary) return;
    const attempt = await document.get(domainId, ATTEMPT, rdoc.preliminary.attemptId);
    if (!attempt) return;
    const revision = await getRevisionById(domainId, attempt.revisionId);
    if (!revision) return;
    const question = revision.sections.flatMap((section) => section.questions)
        .find((item) => item.id === rdoc.preliminary.questionId);
    if (!question || question.type !== 'programming') return;
    const awarded = question.score * question.multiplier * (rdoc.score || 0) / 100;
    await document.coll.updateOne(
        { domainId, docType: ATTEMPT, docId: attempt.docId, results: { $elemMatch: { questionId: question.id, $or: [{ rid: { $exists: false } }, { rid: rdoc._id }] } } },
        [
            { $set: { results: { $map: { input: '$results', as: 'r', in: { $cond: [
                { $eq: ['$$r.questionId', question.id] },
                { $mergeObjects: ['$$r', { score: awarded, maxScore: question.score * question.multiplier, correct: rdoc.score >= 100, status: 'completed', judgeScore: rdoc.score, rid: rdoc._id }] },
                '$$r',
            ] } } } } },
            { $set: { score: { $sum: '$results.score' }, totalScore: preliminaryTotalScore(revision), status: { $cond: [{ $anyElementTrue: { $map: { input: '$results', as: 'r', in: { $eq: ['$$r.status', 'pending'] } } } }, 'pending', 'completed'] } } },
        ],
    );
}

export async function getAttempt(domainId: string, paperId: ObjectId, attemptId: ObjectId) {
    const attempt = await document.get(domainId, ATTEMPT, attemptId);
    if (!attempt || !attempt.paperId.equals(paperId)) throw new PreliminaryAttemptNotFoundError(attemptId);
    return attempt;
}

export const getAttempts = (domainId: string, query: Filter<PreliminaryAttemptDoc>) =>
    document.getMulti(domainId, ATTEMPT, query).sort({ _id: -1 });

export async function del(domainId: string, paperId: ObjectId) {
    await Promise.all([
        document.coll.deleteMany({
            domainId,
            $or: [
                { docType: PAPER, docId: paperId },
                { docType: { $in: [REVISION, ATTEMPT] }, parentType: PAPER, parentId: paperId },
            ],
        }),
        document.collStatus.deleteMany({
            domainId,
            $or: [
                { docType: PAPER, docId: paperId },
                { docType: { $in: [REVISION, ATTEMPT] }, parentType: PAPER, parentId: paperId },
            ],
        }),
    ]);
}

global.Hydro.model.preliminary = {
    add,
    del,
    edit,
    get,
    getAttempt,
    getAttempts,
    getMulti,
    getRevision,
    getRevisionById,
    submit,
    updateProgrammingResult,
};
