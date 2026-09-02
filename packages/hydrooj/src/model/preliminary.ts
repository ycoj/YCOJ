import { Filter, ObjectId } from 'mongodb';
import {
    PreliminaryAttemptNotFoundError, PreliminaryPaperNotFoundError, PreliminaryPaperNotPublishedError,
    ValidationError,
} from '../error';
import type {
    PreliminaryAttemptDoc, PreliminaryPaperDoc,
} from '../interface';
import {
    normalizePreliminaryAnswers, normalizePreliminaryDefinition, scorePreliminaryAnswers,
} from '../lib/preliminary';
import * as document from './document';

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
) {
    const paper = await get(domainId, paperId);
    if (!paper.published) throw new PreliminaryPaperNotPublishedError(paperId);
    const revision = await getRevision(domainId, paperId, revisionNumber);
    if (!revision) throw new ValidationError('revision', null, 'This paper revision is no longer available.');
    const answers = normalizePreliminaryAnswers(revision, answerInput);
    const graded = scorePreliminaryAnswers(revision, answers);
    const submittedAt = new Date();
    const attemptId = await document.add(
        domainId, '', owner, ATTEMPT, null, PAPER, paperId,
        {
            paperId,
            revisionId: revision.docId,
            revision: revision.revision,
            answers,
            ...graded,
            submittedAt,
        },
    );
    const claimed = await document.coll.findOneAndUpdate(
        { domainId, docType: PAPER, docId: paperId, published: true },
        { $inc: { nAttempt: 1 } },
        { returnDocument: 'after' },
    ) as PreliminaryPaperDoc;
    if (!claimed) {
        await document.deleteOne(domainId, ATTEMPT, attemptId);
        throw new PreliminaryPaperNotPublishedError(paperId);
    }
    return await document.get(domainId, ATTEMPT, attemptId);
}

export async function getAttempt(domainId: string, paperId: ObjectId, attemptId: ObjectId) {
    const attempt = await document.get(domainId, ATTEMPT, attemptId);
    if (!attempt || !attempt.paperId.equals(paperId)) throw new PreliminaryAttemptNotFoundError(attemptId);
    return attempt;
}

export const getAttempts = (domainId: string, query: Filter<PreliminaryAttemptDoc>) =>
    document.getMulti(domainId, ATTEMPT, query).sort({ _id: -1 });

export async function del(domainId: string, paperId: ObjectId) {
    // Papers, revisions, and attempts share the document collection, so the
    // whole cascade is a single delete statement and cannot leave orphans.
    await document.coll.deleteMany({
        domainId,
        $or: [
            { docType: PAPER, docId: paperId },
            { docType: { $in: [REVISION, ATTEMPT] }, parentType: PAPER, parentId: paperId },
        ],
    });
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
};
