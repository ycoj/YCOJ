import fs from 'fs';
import path from 'path';
import { globbySync } from 'globby';
import { isMap, parseDocument, Scalar } from 'yaml';

const DEFAULT_PATTERNS = [
    'packages/**/locale/*.yaml',
    'packages/**/locales/*.yaml',
];

function compareKeys(left: string, right: string) {
    return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })
        || left.localeCompare(right, 'en', { numeric: true });
}

export function sortLocaleSource(source: string, filename = '<locale>') {
    const document = parseDocument(source, {
        keepSourceTokens: true,
        uniqueKeys: true,
    });
    if (document.errors.length) {
        throw new Error(`${filename}: ${document.errors.map((error) => error.message).join('; ')}`);
    }
    if (!isMap(document.contents)) throw new TypeError(`${filename}: locale root must be a YAML map`);
    for (const pair of document.contents.items) {
        if (!(pair.key instanceof Scalar) || pair.key.value === null || typeof pair.key.value === 'object') {
            throw new TypeError(`${filename}: every locale key must be a scalar`);
        }
    }
    document.contents.items.sort((left, right) => compareKeys(
        String((left.key as Scalar).value),
        String((right.key as Scalar).value),
    ));
    return document.toString({ lineWidth: 0 });
}

function main() {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const patterns = args.filter((arg) => arg !== '--check');
    const files = globbySync(patterns.length ? patterns : DEFAULT_PATTERNS, {
        absolute: true,
        cwd: process.cwd(),
        onlyFiles: true,
    }).sort();
    if (!files.length) throw new Error('No locale YAML files matched.');

    const changed: string[] = [];
    for (const filename of files) {
        const source = fs.readFileSync(filename, 'utf8');
        const sorted = sortLocaleSource(source, filename);
        if (source === sorted) continue;
        changed.push(path.relative(process.cwd(), filename));
        if (!check) fs.writeFileSync(filename, sorted);
    }

    if (check && changed.length) {
        console.error(`Unsorted locale files:\n${changed.map((filename) => `- ${filename}`).join('\n')}`);
        process.exitCode = 1;
    } else if (changed.length) {
        console.log(`Sorted ${changed.length} locale file(s).`);
    } else console.log(`All ${files.length} locale file(s) are sorted.`);
}

if (require.main === module) main();
