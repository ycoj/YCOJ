import path from 'path';
import { fileURLToPath } from 'url';
import codspeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [codspeedPlugin()],
    resolve: {
        alias: {
            // Benchmarked sources are plain TypeScript files inside the workspace,
            // resolve them directly instead of going through node_modules symlinks.
            '@hydrooj/utils/lib/common': path.resolve(root, 'framework/utils/lib/common.ts'),
        },
    },
    test: {
        // Unit tests are run by `yarn test` through node:test, this config only serves benchmarks.
        include: [],
        benchmark: {
            include: ['benchmark/**/*.bench.ts'],
        },
    },
});
