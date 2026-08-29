import * as setting from '../../setting';
import { isCppLang } from './inspect';

export function listAllowedCppLangs(tdoc: { langs?: string[] }, domainLangs?: string) {
    const filters: string[][] = [];
    if (tdoc.langs?.length) filters.push(tdoc.langs);
    if (domainLangs) {
        const langs = domainLangs.split(',').map((i) => i.trim()).filter(Boolean);
        if (langs.length) filters.push(langs);
    }
    const all = Object.keys(setting.langs).filter((i) => {
        const cfg = setting.langs[i];
        if (!cfg || cfg.disabled || cfg.remote) return false;
        if (!filters.length && cfg.hidden) return false;
        return isCppLang(i);
    });
    return filters.reduce((acc, filter) => acc.filter((lang) => filter.includes(lang)), all);
}
