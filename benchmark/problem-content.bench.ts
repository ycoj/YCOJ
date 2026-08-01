import { bench, describe } from 'vitest';
import { buildContent, ProblemSource } from '../packages/hydrooj/src/lib/content';

const paragraph = Array.from({ length: 12 }, (_, i) => (
    `Given an array $a_1, a_2, \\dots, a_n$ of $n$ integers, answer $q$ queries of type ${i + 1}.`
)).join('\n\n');

const source: ProblemSource = {
    background: paragraph,
    description: paragraph,
    input: 'The first line contains two integers $n$ and $q$.\n\n' + paragraph,
    output: 'For each query output a single integer.\n\n' + paragraph,
    samples: Array.from({ length: 8 }, (_, i) => [
        `${i + 1} ${i + 2}\n${Array.from({ length: 20 }, (_, j) => j * (i + 1)).join(' ')}`,
        Array.from({ length: 20 }, (_, j) => j + i).join('\n'),
    ] as [string, string]),
    hint: paragraph,
    source: 'YCOJ Round #1',
};

const translate = (s: string) => `${s}`;

describe('hydrooj/content', () => {
    bench('buildContent markdown', () => {
        buildContent(source, 'markdown');
    });

    bench('buildContent html', () => {
        buildContent(source, 'html');
    });

    bench('buildContent markdown with translation', () => {
        buildContent(source, 'markdown', translate);
    });
});
