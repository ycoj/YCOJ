import { ObjectId } from 'mongodb';
import { getAlphabeticId } from '@hydrooj/utils/lib/utils';
import { ContestNotLiveError, ValidationError } from '../../error';
import * as contest from '../../model/contest';
import { listAllowedCppLangs } from '../../model/contest/bulkSubmit/config';
import {
    buildBulkSubmitMappingDefaults, BULK_SUBMIT_ZIP_MODES, BulkSubmitExistingUserPolicy, BulkSubmitMappingError, BulkSubmitZipMode,
    DEFAULT_BULK_SUBMIT_EXISTING_USER_POLICY, isCppLang, parseProblemMapping, pickDefaultCppLang,
} from '../../model/contest/bulkSubmit/inspect';
import { processContestBulkSubmit } from '../../model/contest/bulkSubmit/process';
import problem from '../../model/problem';
import * as setting from '../../model/setting';
import user from '../../model/user';
import { param, post, Types } from '../../service/server';
import { ContestManagementBaseHandler } from './managementBase';

export class ContestBulkSubmitHandler extends ContestManagementBaseHandler {
    @param('tid', Types.ObjectId)
    async get(domainId: string, _tid: ObjectId) {
        const pdict = await problem.getList(domainId, this.tdoc.pids, true, true, problem.PROJECTION_CONTEST_LIST);
        const cppLangs = listAllowedCppLangs(this.tdoc, this.domain.langs);
        const langRange = Object.fromEntries(cppLangs.map((l) => [l, setting.langs[l]?.display || l]));
        const mappingDefaults = buildBulkSubmitMappingDefaults(
            this.tdoc.pids,
            pdict,
            this.tdoc.pids.map((pid, i) => (pdict[pid]?.pid ? String(pdict[pid].pid) : getAlphabeticId(i))),
        );
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: this.tsdoc,
            owner_udoc: await user.getById(domainId, this.tdoc.owner),
            pdict,
            langRange,
            defaultLang: pickDefaultCppLang(cppLangs) || '',
            mappingDefaults,
        };
        this.response.template = 'contest_bulk_submit.html';
    }

    @param('tid', Types.ObjectId)
    @post('mapping', Types.Any)
    @post('lang', Types.Name, true)
    @post('dryrun', Types.Boolean)
    @post('existingUser', Types.Range(['vuser', 'existing']), true)
    @post('zipMode', Types.Range([...BULK_SUBMIT_ZIP_MODES]), true)
    async post(
        domainId: string, tid: ObjectId, mappingRaw: unknown, lang = '', dryrun = false,
        existingUser: BulkSubmitExistingUserPolicy = DEFAULT_BULK_SUBMIT_EXISTING_USER_POLICY,
        zipMode: BulkSubmitZipMode = 'auto',
    ) {
        if (contest.isNotStarted(this.tdoc)) throw new ContestNotLiveError(domainId, tid);
        const cppLangs = listAllowedCppLangs(this.tdoc, this.domain.langs);
        const submitLang = lang || pickDefaultCppLang(cppLangs);
        if (!submitLang || !isCppLang(submitLang) || !cppLangs.includes(submitLang)
            || !setting.langs[submitLang] || setting.langs[submitLang].disabled) {
            throw new ValidationError('lang');
        }
        let mapping: Record<number, string>;
        try {
            mapping = parseProblemMapping(mappingRaw, this.tdoc.pids);
        } catch (e) {
            if (e instanceof BulkSubmitMappingError) throw new ValidationError('mapping', null, e.message);
            throw e;
        }
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        const filename = file.originalFilename || '';
        if (!filename.toLowerCase().endsWith('.zip')) throw new ValidationError('file', null, 'Only zip files are allowed');
        this.response.body = await processContestBulkSubmit({
            domainId,
            tid,
            pids: this.tdoc.pids,
            beginAt: this.tdoc.beginAt,
            filePath: file.filepath,
            mapping,
            submitLang,
            dryrun,
            existingUser,
            zipMode,
        });
    }
}
