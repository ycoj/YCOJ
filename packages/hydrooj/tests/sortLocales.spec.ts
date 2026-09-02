import assert from 'assert';
import { describe, it } from 'node:test';
import { sortLocaleSource } from '../../../build/sortLocales';

describe('locale sorting', () => {
    it('sorts scalar keys deterministically and preserves attached comments', () => {
        const input = 'z: last\n# explanation for alpha\na: first\n404: missing\n';
        assert.equal(sortLocaleSource(input), '404: missing\n# explanation for alpha\na: first\nz: last\n');
    });

    it('rejects duplicate keys and non-map roots', () => {
        assert.throws(() => sortLocaleSource('a: one\na: two\n'));
        assert.throws(() => sortLocaleSource('- item\n'));
    });
});
