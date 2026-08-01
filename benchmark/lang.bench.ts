import { readFileSync } from 'fs';
import path from 'path';
import { bench, describe } from 'vitest';
import { parseLang } from '../packages/common/lang';

// The real language definition shipped with hydrojudge.
const langs = readFileSync(path.resolve(__dirname, '../packages/hydrojudge/langs.yaml'), 'utf-8');
// A bigger, more realistic instance deployment which extends the shipped languages.
const extendedLangs = [
    langs,
    ...Array.from({ length: 8 }, (_, i) => [
        `cc.cc14o2v${i}:`,
        `  display: C++14 (O2) variant ${i}`,
        '  compile: /usr/bin/g++ -O2 -std=c++14 -o /w/foo /w/foo.cc',
        '  code_file: foo.cc',
        '  execute: /w/foo',
        '  time_limit_rate: 1',
    ].join('\n')),
].join('\n');

describe('common/lang', () => {
    bench('parseLang (shipped langs.yaml)', () => {
        parseLang(langs);
    });

    bench('parseLang (extended langs.yaml)', () => {
        parseLang(extendedLangs);
    });
});
