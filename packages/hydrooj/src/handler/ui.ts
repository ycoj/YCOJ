import { intersection } from 'lodash';
import { ObjectId } from 'mongodb';
import { PERM, PRIV } from '@hydrooj/common';
import { Context } from '../context';
import { NotFoundError } from '../error';
import * as contest from '../model/contest';
import ProblemModel from '../model/problem';
import { langs } from '../model/setting';
import user from '../model/user';
import { Handler, param, Types } from '../service/server';

export class NavHandler extends Handler {
    skipRealnameCheck = true;
    async get({ domainId }) {
        this.response.body.navItems = global.Hydro.ui.getNodes('Nav').filter((x) => x.checker(this));
        this.response.body.user = await user.getById(domainId, this.user._id);
        this.response.body.user.modType = this.user.hasPriv(PRIV.PRIV_MOD_BADGE) ? 'su' : this.user.hasPerm(PERM.PERM_MOD_BADGE) ? 'mod' : null;
    }
}

export class AvailableLanguageHandler extends Handler {
    @param('pid', Types.ProblemId, true)
    async get(domainId: string, pid?: number | string) {
        interface AvailableLanguageVersion {
            display: string;
            name: string;
            /** Explicit pretest mapping configured for this language, if any. */
            pretest?: string | false;
            /** Whether the language is marked hidden in the language config. */
            hidden?: boolean;
            /** Language key to use on the current problem's remote judge provider, if mapped. */
            validAs?: string;
        }
        interface AvailableLanguageResponse {
            languages: Record<string, {
                display: string;
                versions: AvailableLanguageVersion[];
            }>;
        }

        const languages: AvailableLanguageResponse['languages'] = {};
        let configLangs: string[] = [];
        // Only resolvable for a specific problem: validAs is provider-scoped.
        let remoteProvider: string | undefined;

        if (pid) {
            const pdoc = await ProblemModel.get(domainId, pid);
            if (!pdoc) throw new NotFoundError(pid);
            configLangs = (typeof pdoc.config === 'object' && pdoc.config?.langs) || [];
            if (typeof pdoc.config === 'object' && pdoc.config?.type === 'remote_judge') {
                remoteProvider = pdoc.config.subType;
            }
        }

        const buildVersion = (lang: string): AvailableLanguageVersion => {
            const config = langs[lang];
            const version: AvailableLanguageVersion = { display: config.display, name: lang };
            // Keep `false` (explicitly disabled pretest) distinct from "not configured".
            if (config.pretest !== undefined) version.pretest = config.pretest;
            if (config.hidden !== undefined) version.hidden = config.hidden;
            const validAs = remoteProvider ? config.validAs?.[remoteProvider] : undefined;
            if (validAs !== undefined) version.validAs = validAs;
            return version;
        };

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
                versions: [buildVersion(lang)],
            };
        }

        for (const lang of Object.keys(langs)) {
            if (langs[lang].disabled) continue;
            if (langs[lang].hidden && !isLangAllowed(lang)) continue;
            if (!lang.includes('.')) continue;
            const mainLang = lang.split('.')[0];
            if (!languages[mainLang]) continue;
            if (!isLangAllowed(lang)) continue;
            languages[mainLang].versions.push(buildVersion(lang));
        }

        this.response.body = { languages };
    }
}

export class RichMediaJsonHandler extends Handler {
    @param('uids', Types.ArrayOf(Types.Int), true)
    @param('pids', Types.ArrayOf(Types.Int), true) // problem ids
    @param('cids', Types.ArrayOf(Types.ObjectId), true) // contest ids
    @param('hids', Types.ArrayOf(Types.ObjectId), true) // homework ids
    async post(domainId: string, uids?: number[], pids?: number[], cids?: ObjectId[], hids?: ObjectId[]) {
        const udict: Record<number, any> = {};
        const pdict: Record<number, any> = {};
        const cdict: Record<string, any> = {};
        const hdict: Record<string, any> = {};

        if (uids?.length && this.user.hasPerm(PERM.PERM_VIEW)) {
            Object.assign(udict, await user.getListForRender(
                domainId, uids, this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO),
            ));
        }

        if (pids?.length && this.user.hasPerm(PERM.PERM_VIEW | PERM.PERM_VIEW_PROBLEM)) {
            const canViewHidden = this.user.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN) ? true : this.user._id;
            Object.assign(pdict, await ProblemModel.getList(
                domainId, pids, canViewHidden, false, ProblemModel.PROJECTION_LIST,
            ));
        }

        const userGroups = (cids?.length || hids?.length)
            ? (this.user.group ? (Array.isArray(this.user.group) ? this.user.group : [...this.user.group]) : [])
            : [];

        if (cids?.length && this.user.hasPerm(PERM.PERM_VIEW | PERM.PERM_VIEW_CONTEST)) {
            await Promise.all(cids.map(async (cid) => {
                try {
                    const tdoc = await contest.get(domainId, cid);
                    if (tdoc && tdoc.rule !== 'homework') {
                        const canView = !tdoc.assign?.length
                            || this.user.own(tdoc)
                            || this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST)
                            || (userGroups.length > 0 && intersection(tdoc.assign, userGroups).length > 0);
                        if (canView) cdict[cid.toString()] = tdoc;
                    }
                } catch { /* skip inaccessible or missing */ }
            }));
        }

        if (hids?.length && this.user.hasPerm(PERM.PERM_VIEW | PERM.PERM_VIEW_HOMEWORK)) {
            await Promise.all(hids.map(async (hid) => {
                try {
                    const tdoc = await contest.get(domainId, hid);
                    if (tdoc && tdoc.rule === 'homework') {
                        const canView = !tdoc.assign?.length
                            || this.user.own(tdoc)
                            || this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_HOMEWORK)
                            || (userGroups.length > 0 && intersection(tdoc.assign, userGroups).length > 0);
                        if (canView) hdict[hid.toString()] = tdoc;
                    }
                } catch { /* skip inaccessible or missing */ }
            }));
        }

        this.response.body = { udict, pdict, cdict, hdict };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('ui_nav', '/ui/nav', NavHandler);
    ctx.Route('ui_languages', '/ui/languages', AvailableLanguageHandler);
    ctx.Route('ui_media_json', '/ui/media', RichMediaJsonHandler);
}
