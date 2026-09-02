import { ValidationError } from '../error';
import type {
    PreliminaryAttemptDoc, PreliminaryPaperDefinition, PreliminaryQuestion,
    PreliminaryQuestionResult, PreliminaryRevisionDoc,
} from '../interface';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SECTIONS = 100;
const MAX_QUESTIONS = 200;

function invalid(field: string, message: string): never {
    throw new ValidationError(field, null, message);
}

function text(value: unknown, field: string, max: number, required = false) {
    if (typeof value !== 'string') return invalid(field, 'Expected a string');
    const result = value.trim();
    if (required && !result) return invalid(field, 'This field is required');
    if (result.length > max) return invalid(field, `Must not exceed ${max} characters`);
    return result;
}

function id(value: unknown, field: string) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        return invalid(field, 'Expected a stable identifier');
    }
    return value;
}

export function normalizePreliminaryDefinition(
    value: unknown,
    requireComplete = false,
): PreliminaryPaperDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('definition', 'Expected an object');
    const input = value as Record<string, unknown>;
    const title = text(input.title, 'title', 64, true);
    const content = text(input.content ?? '', 'content', 65535);
    if (!Array.isArray(input.sections) || input.sections.length > MAX_SECTIONS) {
        invalid('sections', `Expected at most ${MAX_SECTIONS} sections`);
    }
    if (requireComplete && !input.sections.length) invalid('sections', 'A published paper needs at least one section');

    const ids = new Set<string>();
    let questionCount = 0;
    const sections = input.sections.map((rawSection, sectionIndex) => {
        const field = `sections.${sectionIndex}`;
        if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) invalid(field, 'Expected an object');
        const section = rawSection as Record<string, unknown>;
        const sectionId = id(section.id, `${field}.id`);
        if (ids.has(sectionId)) invalid(`${field}.id`, 'Duplicate identifier');
        ids.add(sectionId);
        if (!['single_choice', 'program_reading', 'program_completion'].includes(section.type as string)) {
            invalid(`${field}.type`, 'Unsupported section type');
        }
        const type = section.type as 'single_choice' | 'program_reading' | 'program_completion';
        const titleValue = text(section.title ?? '', `${field}.title`, 255, requireComplete);
        const sectionContent = text(
            section.content ?? '', `${field}.content`, 65535,
            requireComplete && type !== 'single_choice',
        );
        if (!Array.isArray(section.questions)) invalid(`${field}.questions`, 'Expected an array');
        if (requireComplete && !section.questions.length) invalid(`${field}.questions`, 'A section needs at least one question');
        questionCount += section.questions.length;
        if (questionCount > MAX_QUESTIONS) invalid('sections', `Expected at most ${MAX_QUESTIONS} questions`);

        const questions = section.questions.map((rawQuestion, questionIndex): PreliminaryQuestion => {
            const qfield = `${field}.questions.${questionIndex}`;
            if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) invalid(qfield, 'Expected an object');
            const question = rawQuestion as Record<string, unknown>;
            const questionId = id(question.id, `${qfield}.id`);
            if (ids.has(questionId)) invalid(`${qfield}.id`, 'Duplicate identifier');
            ids.add(questionId);
            if (!['choice', 'true_false'].includes(question.type as string)) invalid(`${qfield}.type`, 'Unsupported question type');
            if (type !== 'program_reading' && question.type !== 'choice') {
                invalid(`${qfield}.type`, 'Only program-reading sections support true/false questions');
            }
            const prompt = text(question.prompt ?? '', `${qfield}.prompt`, 16384, requireComplete);
            const explanation = text(question.explanation ?? '', `${qfield}.explanation`, 32768);
            const score = Number(question.score);
            if (!Number.isSafeInteger(score) || score < 1 || score > 1000) {
                invalid(`${qfield}.score`, 'Expected an integer from 1 to 1000');
            }
            if (question.type === 'true_false') {
                if (!['true', 'false'].includes(question.answer as string)) {
                    invalid(`${qfield}.answer`, 'Expected true or false');
                }
                return {
                    id: questionId,
                    type: 'true_false',
                    prompt,
                    score,
                    explanation,
                    answer: question.answer as 'true' | 'false',
                };
            }
            if (!Array.isArray(question.options) || question.options.length > 26) {
                invalid(`${qfield}.options`, 'Expected at most 26 options');
            }
            if (requireComplete && question.options.length < 2) invalid(`${qfield}.options`, 'A choice question needs at least two options');
            const optionIds = new Set<string>();
            const options = question.options.map((rawOption, optionIndex) => {
                const ofield = `${qfield}.options.${optionIndex}`;
                if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) invalid(ofield, 'Expected an object');
                const option = rawOption as Record<string, unknown>;
                const optionId = id(option.id, `${ofield}.id`);
                if (optionIds.has(optionId)) invalid(`${ofield}.id`, 'Duplicate option identifier');
                optionIds.add(optionId);
                return {
                    id: optionId,
                    text: text(option.text ?? '', `${ofield}.text`, 8192, requireComplete),
                };
            });
            const answer = typeof question.answer === 'string' ? question.answer : '';
            if (requireComplete && !optionIds.has(answer)) invalid(`${qfield}.answer`, 'Select a valid correct answer');
            return {
                id: questionId,
                type: 'choice',
                prompt,
                score,
                explanation,
                options,
                answer,
            };
        });
        return {
            id: sectionId,
            type,
            title: titleValue,
            content: sectionContent,
            questions,
        };
    });
    return { title, content, sections };
}

export function preliminaryQuestionCount(definition: PreliminaryPaperDefinition) {
    return definition.sections.reduce((sum, section) => sum + section.questions.length, 0);
}

export function preliminaryTotalScore(definition: PreliminaryPaperDefinition) {
    return definition.sections.reduce(
        (sum, section) => sum + section.questions.reduce((sectionSum, question) => sectionSum + question.score, 0),
        0,
    );
}

export function normalizePreliminaryAnswers(
    definition: PreliminaryPaperDefinition,
    input: unknown,
): Record<string, string> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('answers', 'Expected an object');
    const questions = new Map<string, PreliminaryQuestion>();
    for (const section of definition.sections) {
        for (const question of section.questions) questions.set(question.id, question);
    }
    const answers: Record<string, string> = {};
    for (const [questionId, answer] of Object.entries(input as Record<string, unknown>)) {
        const question = questions.get(questionId);
        if (!question || typeof answer !== 'string') invalid('answers', 'Contains an invalid question or answer');
        if (question.type === 'true_false') {
            if (!['true', 'false'].includes(answer)) invalid('answers', 'Contains an invalid true/false answer');
        } else if (!question.options.some((option) => option.id === answer)) {
            invalid('answers', 'Contains an invalid choice answer');
        }
        answers[questionId] = answer;
    }
    return answers;
}

export function scorePreliminaryAnswers(
    definition: PreliminaryPaperDefinition,
    answers: Record<string, string>,
) {
    const results: PreliminaryQuestionResult[] = [];
    let score = 0;
    for (const section of definition.sections) {
        for (const question of section.questions) {
            const correct = answers[question.id] === question.answer;
            const awarded = correct ? question.score : 0;
            score += awarded;
            results.push({
                questionId: question.id,
                ...answers[question.id] ? { answer: answers[question.id] } : {},
                correct,
                score: awarded,
                maxScore: question.score,
            });
        }
    }
    return { results, score, totalScore: preliminaryTotalScore(definition) };
}

export function toPublicPreliminaryDefinition(definition: PreliminaryPaperDefinition) {
    return {
        title: definition.title,
        content: definition.content,
        sections: definition.sections.map((section) => ({
            ...section,
            questions: section.questions.map((question) => {
                const { answer, explanation, ...publicQuestion } = question;
                return publicQuestion;
            }),
        })),
    };
}

export function toPreliminaryReview(
    revision: PreliminaryRevisionDoc,
    attempt: PreliminaryAttemptDoc,
) {
    const resultMap = new Map(attempt.results.map((result) => [result.questionId, result]));
    return {
        title: revision.title,
        content: revision.content,
        sections: revision.sections.map((section) => ({
            ...section,
            questions: section.questions.map((question) => {
                const result = resultMap.get(question.id);
                const { answer: correctAnswer, explanation, ...publicQuestion } = question;
                return {
                    ...publicQuestion,
                    result,
                    ...(result?.correct ? {} : {
                        correctAnswer,
                        ...explanation ? { explanation } : {},
                    }),
                };
            }),
        })),
    };
}
