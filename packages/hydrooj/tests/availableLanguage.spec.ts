import assert from 'assert';
import { describe, it } from 'node:test';

function mockModule(request: string, exports: unknown) {
    const filename = require.resolve(request);
    require.cache[filename] = { exports } as NodeJS.Module;
}

class NotFoundError extends Error { }

mockModule('../src/error', { NotFoundError });
mockModule('../src/context', {});
mockModule('../src/service/server', {
    Handler: class { },
    param: () => (_target: unknown, _name: string, descriptor: PropertyDescriptor) => descriptor,
    Types: new Proxy({}, { get: () => (..._args: unknown[]) => ({}) }),
});
const problemMock: { get: (domainId: string, pid: number | string) => Promise<any> } = {
    get: async () => null,
};
const settingMock: { langs: Record<string, any> } = { langs: {} };
mockModule('../src/model/problem', problemMock);
mockModule('../src/model/setting', settingMock);
mockModule('../src/model/contest', {});
mockModule('../src/model/user', { getById: async () => ({}) });

Object.assign(global, { Hydro: { model: {}, ui: {} } });
const { AvailableLanguageHandler } = require('../src/handler/ui') as typeof import('../src/handler/ui');

/** Build a lang config with the defaults `parseLang` guarantees. */
function lang(key: string, config: Record<string, any> = {}) {
    return {
        key,
        display: key,
        hidden: false,
        disabled: false,
        remote: false,
        validAs: {},
        ...config,
    };
}

async function query(langs: Record<string, any>, pdoc?: any) {
    settingMock.langs = langs;
    problemMock.get = async () => pdoc ?? null;
    const handler = Object.create(AvailableLanguageHandler.prototype) as any;
    handler.response = { body: {} };
    await handler.get('system', pdoc ? 1000 : undefined);
    return handler.response.body.languages;
}

describe('available language endpoint', () => {
    it('resolves validAs from the problem provider for remote judge problems', async () => {
        const languages = await query({
            cc: lang('cc', { display: 'C++' }),
            'cc.cc17': lang('cc.cc17', { display: 'C++17', validAs: { judgeclient: 'judgeclient.0' } }),
        }, { config: { type: 'remote_judge', subType: 'judgeclient', langs: ['cc.cc17'] } });
        assert.deepStrictEqual(languages, {
            cc: {
                display: 'C++',
                versions: [
                    { display: 'C++', name: 'cc', hidden: false },
                    {
                        display: 'C++17', name: 'cc.cc17', hidden: false, validAs: 'judgeclient.0',
                    },
                ],
            },
        });
    });

    it('returns the configured pretest mapping', async () => {
        const languages = await query({
            cc: lang('cc', { display: 'C++' }),
            'cc.cc17': lang('cc.cc17', { display: 'C++17', pretest: 'cc.cc14' }),
        }, { config: { type: 'remote_judge', subType: 'codeforces', langs: ['cc.cc17'] } });
        assert.deepStrictEqual(languages.cc.versions[1], {
            display: 'C++17', name: 'cc.cc17', hidden: false, pretest: 'cc.cc14',
        });
    });

    it('preserves pretest: false instead of dropping it', async () => {
        const languages = await query({
            py: lang('py', { display: 'Python', pretest: false }),
        }, { config: { type: 'default', langs: [] } });
        const [version] = languages.py.versions;
        assert.ok('pretest' in version, 'pretest: false must survive serialization');
        assert.strictEqual(version.pretest, false);
    });

    it('omits validAs when the language has no mapping for the provider', async () => {
        const languages = await query({
            cc: lang('cc', { display: 'C++' }),
            'cc.cc17': lang('cc.cc17', { display: 'C++17', validAs: { codeforces: 'cf.54' } }),
        }, { config: { type: 'remote_judge', subType: 'judgeclient', langs: ['cc.cc17'] } });
        const version = languages.cc.versions[1];
        assert.strictEqual(version.validAs, undefined);
        assert.ok(!('validAs' in version), 'unmatched provider must not emit a validAs key');
    });

    it('leaves validAs undefined without a pid', async () => {
        const languages = await query({
            cc: lang('cc', { display: 'C++' }),
            'cc.cc17': lang('cc.cc17', { display: 'C++17', validAs: { judgeclient: 'judgeclient.0' } }),
        });
        for (const version of languages.cc.versions) {
            assert.ok(!('validAs' in version), `${version.name} must not expose validAs without a pid`);
        }
    });

    it('leaves validAs undefined for non remote judge problems', async () => {
        const languages = await query({
            cc: lang('cc', { display: 'C++' }),
            'cc.cc17': lang('cc.cc17', { display: 'C++17', validAs: { judgeclient: 'judgeclient.0' } }),
        }, { config: { type: 'default', subType: 'judgeclient', langs: ['cc.cc17'] } });
        assert.strictEqual(languages.cc.versions[1].validAs, undefined);
    });

    it('excludes disabled languages and keeps hidden filtering intact', async () => {
        const languages = await query({
            cc: lang('cc', { display: 'C++' }),
            'cc.cc17': lang('cc.cc17', { display: 'C++17' }),
            'cc.legacy': lang('cc.legacy', { display: 'C++98', hidden: true }),
            rs: lang('rs', { display: 'Rust', disabled: true }),
        }, { config: { type: 'remote_judge', subType: 'judgeclient', langs: ['cc.cc17'] } });
        assert.deepStrictEqual(Object.keys(languages), ['cc']);
        assert.deepStrictEqual(languages.cc.versions.map((i: any) => i.name), ['cc', 'cc.cc17']);
    });

    it('exposes hidden languages that the problem explicitly allows', async () => {
        const languages = await query({
            cc: lang('cc', { display: 'C++' }),
            'cc.legacy': lang('cc.legacy', { display: 'C++98', hidden: true, validAs: { judgeclient: 'judgeclient.1' } }),
        }, { config: { type: 'remote_judge', subType: 'judgeclient', langs: ['cc.legacy'] } });
        assert.deepStrictEqual(languages.cc.versions[1], {
            display: 'C++98', name: 'cc.legacy', hidden: true, validAs: 'judgeclient.1',
        });
    });

    it('drops a disabled language even when the problem lists it', async () => {
        const languages = await query({
            cc: lang('cc', { display: 'C++' }),
            'cc.old': lang('cc.old', { display: 'C++03', disabled: true }),
        }, { config: { type: 'remote_judge', subType: 'judgeclient', langs: ['cc.old'] } });
        assert.deepStrictEqual(languages.cc.versions.map((i: any) => i.name), ['cc']);
    });

    it('keeps display and name for consumers that ignore the new fields', async () => {
        const languages = await query({
            cc: lang('cc', { display: 'C++' }),
            'cc.cc17': lang('cc.cc17', { display: 'C++17' }),
        });
        for (const version of languages.cc.versions) {
            assert.strictEqual(typeof version.display, 'string');
            assert.strictEqual(typeof version.name, 'string');
            assert.deepStrictEqual(
                Object.keys(version).filter((k) => !['display', 'name', 'pretest', 'hidden', 'validAs'].includes(k)),
                [],
                'no unrelated language config fields may leak',
            );
        }
    });

    it('throws when the pid does not resolve', async () => {
        settingMock.langs = { cc: lang('cc') };
        problemMock.get = async () => null;
        const handler = Object.create(AvailableLanguageHandler.prototype) as any;
        handler.response = { body: {} };
        await assert.rejects(() => handler.get('system', 9999), NotFoundError);
    });
});
