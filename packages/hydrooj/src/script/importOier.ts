import Schema from 'schemastery';
import { loadOierDataDir, parseOierData } from '../lib/oier';
import * as oier from '../model/oier';

export const apply = (ctx) => ctx.addScript(
    'importOier',
    'Import or update CCF/NOI award data from an OIerDb data directory',
    Schema.object({
        dataDir: Schema.string().required(),
        dryrun: Schema.boolean(),
    }),
    async ({ dataDir, dryrun }, report) => {
        await report({ message: `Loading OIerDb data from ${dataDir}` });
        const files = await loadOierDataDir(dataDir);
        await report({ message: `Parsing school.txt (${files.schoolTxt.length} bytes), contests.json, raw.txt (${files.rawTxt.length} bytes)` });
        const parsed = parseOierData(files);
        for (const warning of parsed.warnings.slice(0, 50)) {
            await report({ message: `${warning.file}:${warning.line}: ${warning.message}` });
        }
        if (parsed.warnings.length > 50) {
            await report({ message: `... and ${parsed.warnings.length - 50} more warning(s)` });
        }
        const result = await oier.replaceAll(parsed, report, !!dryrun);
        await report({ message: JSON.stringify(result) });
        return true;
    },
);
