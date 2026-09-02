import assert from 'assert';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import {
    PreliminaryPaperNotFoundError, PreliminaryPaperNotPublishedError, ValidationError,
} from '../src/error';
import type {
    PreliminaryAttemptDoc, PreliminaryPaperDefinition, PreliminaryRevisionDoc,
} from '../src/interface';
import {
    normalizePreliminaryAnswers, normalizePreliminaryDefinition, preliminaryQuestionCount,
    preliminaryTotalScore, scorePreliminaryAnswers, toPreliminaryReview, toPublicPreliminaryDefinition,
} from '../src/lib/preliminary';

function mockModule(request: string, exports: unknown) {
    const filename = require.resolve(request);
    require.cache[filename] = { exports } as NodeJS.Module;
}

type FakeDoc = Record<string, any>;

const isPlainObject = (value: any) => value !== null && typeof value === 'object'
    && !Array.isArray(value) && !(value instanceof Date) && !value._bsontype;

const docEquals = (a: any, b: any) => {
    if (a && b && a._bsontype && b._bsontype) return a.equals(b);
    return a === b;
};

function matches(filter: Record<string, any>, doc: FakeDoc): boolean {
    return Object.entries(filter).every(([key, expected]) => {
        if (key === '$or') return expected.some((sub: Record<string, any>) => matches(sub, doc));
        if (key === '$and') return expected.every((sub: Record<string, any>) => matches(sub, doc));
        if (isPlainObject(expected)) {
            return Object.entries(expected).every(([op, value]) => {
                if (op === '$in') return (value as any[]).some((item) => docEquals(doc[key], item));
                if (op === '$ne') return !docEquals(doc[key], value);
                throw new Error(`Unsupported filter operator ${op}`);
            });
        }
        return docEquals(doc[key], expected);
    });
}

function fakeCollection(store: FakeDoc[]) {
    const query = (filter: Record<string, any>) => store.filter((doc) => matches(filter, doc));
    const cursor = (filter: Record<string, any>) => {
        const result = {
            sort: () => result,
            limit: () => result,
            skip: () => result,
            next: async () => query(filter)[0] ?? null,
            toArray: async () => query(filter),
        };
        return result;
    };
    return {
        insertOne: async (doc: FakeDoc) => {
            store.push(doc);
            return { insertedId: doc._id };
        },
        find: (filter: Record<string, any>) => cursor(filter),
        findOne: async (filter: Record<string, any>) => query(filter)[0] ?? null,
        findOneAndUpdate: async (filter: Record<string, any>, update: Record<string, any>) => {
            const index = store.findIndex((doc) => matches(filter, doc));
            if (index < 0) return null;
            const target = store[index];
            if (update.$set) Object.assign(target, update.$set);
            if (update.$unset) for (const key of Object.keys(update.$unset)) delete target[key];
            if (update.$inc) {
                for (const [key, value] of Object.entries(update.$inc)) target[key] = (target[key] || 0) + (value as number);
            }
            return target;
        },
        deleteOne: async (filter: Record<string, any>) => {
            const index = store.findIndex((doc) => matches(filter, doc));
            if (index < 0) return { deletedCount: 0 };
            store.splice(index, 1);
            return { deletedCount: 1 };
        },
        deleteMany: async (filter: Record<string, any>) => {
            const remaining = store.filter((doc) => !matches(filter, doc));
            const deletedCount = store.length - remaining.length;
            store.length = 0;
            store.push(...remaining);
            return { deletedCount };
        },
    };
}

const documentStore: FakeDoc[] = [];
const collections = new Map<string, ReturnType<typeof fakeCollection>>();
mockModule('../src/service/db', {
    collection: (name: string) => {
        if (!collections.has(name)) collections.set(name, fakeCollection(name === 'document' ? documentStore : []));
        return collections.get(name);
    },
});
mockModule('../src/service/bus', { parallel: async () => { } });
mockModule('../src/context', {});

Object.assign(global, { Hydro: { model: {}, ui: {} } });
const preliminary = require('../src/model/preliminary') as typeof import('../src/model/preliminary');

const byType = (docType: number) => documentStore.filter((doc) => doc.docType === docType);

const definition: PreliminaryPaperDefinition = {
    title: 'CSP-J 2025 Preliminary',
    content: 'Practice paper',
    sections: [
        {
            id: 'section-choice',
            type: 'single_choice',
            title: 'Single Choice',
            content: '',
            questions: [{
                id: 'choice-1',
                type: 'choice',
                prompt: 'Which value is binary `10`?',
                score: 2,
                explanation: 'Binary `10` equals decimal 2.',
                options: [
                    { id: 'one', text: '1' },
                    { id: 'two', text: '2' },
                    { id: 'three', text: '3' },
                ],
                answer: 'two',
            }],
        },
        {
            id: 'section-reading',
            type: 'program_reading',
            title: 'Program Reading',
            content: '```cpp\nint x = 1;\n```',
            questions: [{
                id: 'truth-1',
                type: 'true_false',
                prompt: '`x` is initialized.',
                score: 3,
                explanation: 'The declaration includes an initializer.',
                answer: 'true',
            }],
        },
    ],
};

describe('preliminary paper validation', () => {
    it('normalizes a complete ordered paper and derives totals', () => {
        const normalized = normalizePreliminaryDefinition(definition, true);
        assert.deepEqual(normalized, definition);
        assert.equal(preliminaryQuestionCount(normalized), 2);
        assert.equal(preliminaryTotalScore(normalized), 5);
    });

    it('allows incomplete content in a draft but requires it for publication', () => {
        const draft = structuredClone(definition);
        draft.sections[0].questions[0].prompt = '';
        draft.sections[0].questions[0].explanation = '';
        assert.doesNotThrow(() => normalizePreliminaryDefinition(draft, false));
        assert.throws(() => normalizePreliminaryDefinition(draft, true));
    });

    it('allows empty explanations but still requires valid correct options when publishing', () => {
        const missingExplanation = structuredClone(definition);
        missingExplanation.sections[0].questions[0].explanation = '';
        const published = normalizePreliminaryDefinition(missingExplanation, true);
        assert.equal(published.sections[0].questions[0].explanation, '');

        const invalidAnswer = structuredClone(definition);
        invalidAnswer.sections[0].questions[0].answer = 'missing';
        assert.throws(() => normalizePreliminaryDefinition(invalidAnswer, true));
    });

    it('enforces section-specific question types and stable unique ids', () => {
        const invalidType = structuredClone(definition);
        invalidType.sections[0].questions[0] = structuredClone(definition.sections[1].questions[0]);
        assert.throws(() => normalizePreliminaryDefinition(invalidType, true));

        const duplicate = structuredClone(definition);
        duplicate.sections[1].questions[0].id = duplicate.sections[0].questions[0].id;
        assert.throws(() => normalizePreliminaryDefinition(duplicate, true));
    });
});

describe('preliminary scoring and disclosure', () => {
    it('scores correct, incorrect, and unanswered questions independently', () => {
        const answers = normalizePreliminaryAnswers(definition, { 'choice-1': 'two' });
        const graded = scorePreliminaryAnswers(definition, answers);
        assert.equal(graded.score, 2);
        assert.equal(graded.totalScore, 5);
        assert.deepEqual(graded.results, [
            { questionId: 'choice-1', answer: 'two', correct: true, score: 2, maxScore: 2 },
            { questionId: 'truth-1', correct: false, score: 0, maxScore: 3 },
        ]);
    });

    it('rejects unknown question ids and invalid option ids', () => {
        assert.throws(() => normalizePreliminaryAnswers(definition, { unknown: 'two' }));
        assert.throws(() => normalizePreliminaryAnswers(definition, { 'choice-1': 'missing' }));
        assert.throws(() => normalizePreliminaryAnswers(definition, { 'truth-1': 'yes' }));
    });

    it('removes every answer and explanation from the public definition', () => {
        const publicDefinition = toPublicPreliminaryDefinition(definition);
        for (const section of publicDefinition.sections) {
            for (const question of section.questions) {
                assert.equal('answer' in question, false);
                assert.equal('explanation' in question, false);
            }
        }
    });

    it('reveals correct answers and explanations only for missed questions', () => {
        const revisionId = new ObjectId();
        const paperId = new ObjectId();
        const revision = {
            ...definition,
            _id: revisionId,
            docId: revisionId,
            docType: 91,
            domainId: 'system',
            owner: 2,
            parentType: 90,
            parentId: paperId,
            paperId,
            revision: 1,
            createdAt: new Date(),
        } as PreliminaryRevisionDoc;
        const graded = scorePreliminaryAnswers(definition, { 'choice-1': 'two' });
        const attemptId = new ObjectId();
        const attempt = {
            _id: attemptId,
            docId: attemptId,
            docType: 92,
            domainId: 'system',
            owner: 3,
            parentType: 90,
            parentId: paperId,
            paperId,
            revisionId,
            revision: 1,
            answers: { 'choice-1': 'two' },
            ...graded,
            submittedAt: new Date(),
        } as PreliminaryAttemptDoc;
        const review = toPreliminaryReview(revision, attempt);
        const correct = review.sections[0].questions[0];
        const incorrect = review.sections[1].questions[0];
        assert.equal('correctAnswer' in correct, false);
        assert.equal('explanation' in correct, false);
        assert.equal(incorrect.correctAnswer, 'true');
        assert.equal(incorrect.explanation, definition.sections[1].questions[0].explanation);
    });

    it('omits empty explanations from missed-question review payloads', () => {
        const revisionId = new ObjectId();
        const paperId = new ObjectId();
        const withoutExplanation = structuredClone(definition);
        withoutExplanation.sections[1].questions[0].explanation = '';
        const revision = {
            ...withoutExplanation,
            _id: revisionId,
            docId: revisionId,
            docType: 91,
            domainId: 'system',
            owner: 2,
            parentType: 90,
            parentId: paperId,
            paperId,
            revision: 1,
            createdAt: new Date(),
        } as PreliminaryRevisionDoc;
        const graded = scorePreliminaryAnswers(withoutExplanation, { 'choice-1': 'two' });
        const attemptId = new ObjectId();
        const attempt = {
            _id: attemptId,
            docId: attemptId,
            docType: 92,
            domainId: 'system',
            owner: 3,
            parentType: 90,
            parentId: paperId,
            paperId,
            revisionId,
            revision: 1,
            answers: { 'choice-1': 'two' },
            ...graded,
            submittedAt: new Date(),
        } as PreliminaryAttemptDoc;
        const review = toPreliminaryReview(revision, attempt);
        assert.equal('explanation' in review.sections[1].questions[0], false);
        assert.equal(review.sections[1].questions[0].correctAnswer, 'true');
    });
});

describe('preliminary paper persistence', () => {
    beforeEach(() => {
        documentStore.length = 0;
    });

    it('reports missing papers through the model boundary', async () => {
        await assert.rejects(preliminary.get('system', new ObjectId()), PreliminaryPaperNotFoundError);
    });

    it('keeps drafts unpublished and creates revisions only when publishing', async () => {
        const paperId = await preliminary.add('system', definition, 2);
        assert.equal(byType(90).length, 1);
        assert.equal(byType(91).length, 0);
        assert.equal(byType(90)[0].published, false);
        assert.equal(byType(90)[0].revision, 0);

        const updated = await preliminary.edit('system', paperId, definition, true);
        assert.equal(updated.published, true);
        assert.equal(updated.revision, 1);
        assert.equal(byType(91).length, 1);
        const revision = byType(91)[0];
        assert.equal(revision.parentId.toString(), paperId.toString());
        assert.equal(updated.activeRevisionId.toString(), revision.docId.toString());
    });

    it('rolls back the staged revision when the paper changes while publishing', async () => {
        const paperId = await preliminary.add('system', definition, 2);
        const coll = collections.get('document')!;
        const original = coll.findOneAndUpdate;
        coll.findOneAndUpdate = async (...args: Parameters<typeof original>) => {
            byType(90)[0].revision = 99;
            return original.apply(coll, args);
        };
        try {
            await assert.rejects(preliminary.edit('system', paperId, definition, true), ValidationError);
        } finally {
            coll.findOneAndUpdate = original;
        }
        assert.equal(byType(91).length, 0);
        assert.equal(byType(90).length, 1);
        assert.equal(byType(90)[0].revision, 99);
    });

    it('records graded attempts and increments the attempt counter', async () => {
        const paperId = await preliminary.add('system', definition, 2, true);
        assert.equal(byType(90)[0].published, true);
        assert.equal(byType(90)[0].revision, 1);

        const attempt = await preliminary.submit('system', paperId, 1, 3, { 'choice-1': 'two' }) as PreliminaryAttemptDoc;
        assert.equal(attempt.owner, 3);
        assert.equal(attempt.score, 2);
        assert.equal(attempt.totalScore, 5);
        assert.equal(attempt.revision, 1);
        assert.equal(attempt.paperId.toString(), paperId.toString());
        assert.equal(byType(92).length, 1);
        assert.equal(byType(90)[0].nAttempt, 1);
    });

    it('rejects submissions against unpublished papers', async () => {
        const paperId = await preliminary.add('system', definition, 2);
        await assert.rejects(
            preliminary.submit('system', paperId, 0, 3, {}),
            PreliminaryPaperNotPublishedError,
        );
        assert.equal(byType(92).length, 0);
    });

    it('rejects submissions for revisions that are no longer available', async () => {
        const paperId = await preliminary.add('system', definition, 2, true);
        await assert.rejects(preliminary.submit('system', paperId, 7, 3, {}), ValidationError);
    });

    it('discards a submitted attempt when the paper is unpublished before the claim lands', async () => {
        const paperId = await preliminary.add('system', definition, 2, true);
        const coll = collections.get('document')!;
        const original = coll.findOneAndUpdate;
        coll.findOneAndUpdate = async () => null;
        try {
            await assert.rejects(
                preliminary.submit('system', paperId, 1, 3, { 'choice-1': 'two' }),
                PreliminaryPaperNotPublishedError,
            );
        } finally {
            coll.findOneAndUpdate = original;
        }
        assert.equal(byType(92).length, 0);
        assert.equal(byType(90)[0].nAttempt, 0);
    });

    it('removes the paper together with every revision and attempt', async () => {
        const paperId = await preliminary.add('system', definition, 2, true);
        await preliminary.submit('system', paperId, 1, 3, { 'choice-1': 'two' });
        assert.equal(documentStore.length, 3);

        await preliminary.del('system', paperId);
        assert.equal(documentStore.length, 0);
    });
});
