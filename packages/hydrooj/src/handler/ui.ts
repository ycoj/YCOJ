import { PERM, PRIV } from '@hydrooj/common';
import { Context } from '../context';
import { NotFoundError } from '../error';
import ProblemModel from '../model/problem';
import { langs } from '../model/setting';
import user from '../model/user';
import { Handler, param, Types } from '../service/server';

export class NavHandler extends Handler {
    async get({ domainId }) {
        this.response.body.navItems = global.Hydro.ui.getNodes('Nav').filter((x) => x.checker(this));
        this.response.body.user = await user.getById(domainId, this.user._id);
        this.response.body.user.modType = this.user.hasPriv(PRIV.PRIV_MOD_BADGE) ? 'su' : this.user.hasPerm(PERM.PERM_MOD_BADGE) ? 'mod' : null;
    }
}

export class AvailableLanguageHandler extends Handler {
    @param('pid', Types.ProblemId, true)
    async get(domainId: string, pid?: number | string) {
        interface AvailableLanguageResponse {
            languages: Record<string, {
                display: string;
                versions: {
                    display: string;
                    name: string;
                }[];
            }>;
        }

        const languages: AvailableLanguageResponse['languages'] = {};
        let configLangs: string[] = [];

        if (pid) {
            const pdoc = await ProblemModel.get(domainId, pid);
            if (!pdoc) throw new NotFoundError(pid);
            configLangs = (typeof pdoc.config === 'object' && pdoc.config?.langs) || [];
        }

        const isLangAllowed = (lang: string): boolean => {
            if (!configLangs.length) return true;
            if (configLangs.includes(lang)) return true;
            if (lang.includes('.')) {
                const mainLang = lang.split('.')[0];
                return configLangs.includes(mainLang);
            }
            return configLangs.some((l) => l.startsWith(`${lang}.`));
        };

        for (const lang of Object.keys(langs)) {
            if (langs[lang].disabled) continue;
            if (langs[lang].hidden && !isLangAllowed(lang)) continue;
            if (lang.includes('.')) continue;
            if (!isLangAllowed(lang)) continue;
            languages[lang] = {
                display: langs[lang].display,
                versions: [{ display: langs[lang].display, name: lang }],
            };
        }

        for (const lang of Object.keys(langs)) {
            if (langs[lang].disabled) continue;
            if (langs[lang].hidden && !isLangAllowed(lang)) continue;
            if (!lang.includes('.')) continue;
            const mainLang = lang.split('.')[0];
            if (!languages[mainLang]) continue;
            if (!isLangAllowed(lang)) continue;
            languages[mainLang].versions.push({
                display: langs[lang].display,
                name: lang,
            });
        }

        this.response.body = { languages };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('ui_nav', '/ui/nav', NavHandler);
    ctx.Route('ui_languages', '/ui/languages', AvailableLanguageHandler);
}
