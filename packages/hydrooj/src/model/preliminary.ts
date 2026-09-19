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

const PAPER = document.TYPE_PRELIMINARY_PAPER;
const REVISION = document.TYPE_PRELIMINARY_REVISION;
const ATTEMPT = document.TYPE_PRELIMINARY_ATTEMPT;

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
    for (const section of revision.sections) for (const question of section.questions) {
        if (question.type !== 'programming') continue;
        const answer = rawProgrammingAnswers[question.id];
        if (!answer || typeof answer.code !== 'string' || typeof answer.lang !== 'string' || !answer.code.trim()) continue;
        if (question.languages.length && !question.languages.includes(answer.lang)) {
            throw new ValidationError('programmingAnswers', null, 'Language is not allowed for this question');
        }
        const pdoc = await problem.get(domainId, question.pid);
        if (!pdoc || typeof pdoc.config !== 'object' || ['objective', 'submit_answer'].includes(pdoc.config.type)) {
            throw new ValidationError('programmingAnswers', null, 'Referenced problem is not programmable');
        }
        programmingAnswers[question.id] = answer;
    }
    const submittedAt = new Date();

    let attemptId: ObjectId;
    let attempt: PreliminaryAttemptDoc;
    try {
        const currentPaper = await document.coll.findOne(
            { domainId, docType: PAPER, docId: paperId, published: true },
        );
        if (!currentPaper) throw new PreliminaryPaperNotPublishedError(paperId);

        attemptId = await document.add(
                domainId, '', owner, ATTEMPT, null, PAPER, paperId,
                {
                    paperId,
                    revisionId: revision.docId,
                    revision: revision.revision,
                    answers, programmingAnswers,
                    ...graded,
                    status: Object.keys(programmingAnswers).length ? 'pending' : 'completed',
                    submittedAt,
                },
            );

        const claimed = await document.coll.findOneAndUpdate(
                { domainId, docType: PAPER, docId: paperId, published: true },
                { $inc: { nAttempt: 1 } },
                { returnDocument: 'after' },
            ) as PreliminaryPaperDoc;

        if (!claimed) throw new PreliminaryPaperNotPublishedError(paperId);
        for (const section of revision.sections) for (const question of section.questions) {
            if (question.type !== 'programming') continue;
            const answer = programmingAnswers[question.id];
            if (!answer?.code?.trim()) continue;
            const rid = await (await import('./record')).default.add(
                domainId, question.pid, owner, answer.lang, answer.code, true,
                { type: 'judge', preliminary: { attemptId, questionId: question.id } },
            );
            await document.coll.updateOne(
                { domainId, docType: ATTEMPT, docId: attemptId, 'results.questionId': question.id },
                { $set: { 'results.$.rid': rid, 'results.$.lang': answer.lang } },
            );
        }

        attempt = await document.get(domainId, ATTEMPT, attemptId);
        return attempt;
    } catch (error) {
        if (attemptId) await document.deleteOne(domainId, ATTEMPT, attemptId);
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
    const result = attempt.results.find((item) => item.questionId === question.id);
    if (!result || result.rid && !result.rid.equals(rdoc._id)) return;
    const results = attempt.results.map((item) => item.questionId === question.id
        ? { ...item, score: awarded, maxScore: question.score * question.multiplier, correct: rdoc.score >= 100, status: 'completed' as const, judgeScore: rdoc.score, rid: rdoc._id }
        : item);
    const pending = results.some((item) => item.status === 'pending');
    const score = results.reduce((sum, item) => sum + item.score, 0);
    await document.coll.updateOne(
        { domainId, docType: ATTEMPT, docId: attempt.docId },
        { $set: { results, score, totalScore: preliminaryTotalScore(revision), status: pending ? 'pending' : 'completed' } },
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
