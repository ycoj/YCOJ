import { bench, describe } from 'vitest';
import parser from '../framework/utils/lib/search';

// Same options as the problem list handler uses for every search request.
const options = {
    keywords: ['category', 'difficulty', 'namespace'],
    offsets: false,
    alwaysArray: true,
    tokenize: true,
} as const;

const queries = [
    'binary search',
    'category:dp,graph difficulty:5 shortest path',
    'namespace:codeforces category:"data structure" -category:geometry tree',
    'category:dp,greedy,math,string,graph difficulty:1 difficulty:10 segment tree lazy propagation',
];

const parsed = queries.map((q) => parser.parse(q, options as any));

describe('utils/search', () => {
    bench('parse problem search queries', () => {
        for (const q of queries) parser.parse(q, options as any);
    });

    bench('stringify problem search queries', () => {
        for (const p of parsed) parser.stringify(p as any, options as any);
    });
});
