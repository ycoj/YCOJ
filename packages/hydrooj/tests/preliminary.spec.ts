import assert from 'assert';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import type {
    PreliminaryAttemptDoc, PreliminaryPaperDefinition, PreliminaryRevisionDoc,
} from '../src/interface';
import {
    normalizePreliminaryAnswers, normalizePreliminaryDefinition, preliminaryQuestionCount,
    preliminaryTotalScore, scorePreliminaryAnswers, toPreliminaryReview, toPublicPreliminaryDefinition,
} from '../src/lib/preliminary';

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
