import { bench, describe } from 'vitest';
import difficultyAlgorithm from '../packages/hydrooj/src/lib/difficulty';
import rating from '../packages/hydrooj/src/lib/rating';

// Deterministic pseudo random generator so every run benchmarks the same workload.
function makeUsers(count: number) {
    let seed = 42;
    const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    return Array.from({ length: count }, (_, i) => ({
        uid: i + 1,
        rank: i + 1,
        old: 1000 + Math.floor(next() * 2000),
    }));
}

const smallContest = makeUsers(50);
const mediumContest = makeUsers(200);

const difficultyInputs = Array.from({ length: 500 }, (_, i) => [i * 20 + 1, Math.floor(i * 20 * 0.4)] as const);

describe('hydrooj/rating', () => {
    // rating.calculate mutates ranks, so hand it a copy of the contest standings.
    bench('elo rating for a 50 player contest', () => {
        rating(smallContest.map((i) => ({ ...i })));
    });

    bench('elo rating for a 200 player contest', () => {
        rating(mediumContest.map((i) => ({ ...i })));
    });
});

describe('hydrooj/difficulty', () => {
    bench('difficultyAlgorithm (500 problems)', () => {
        for (const [nSubmit, nAccept] of difficultyInputs) difficultyAlgorithm(nSubmit, nAccept);
    });
});
