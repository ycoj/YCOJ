import Schema from 'schemastery';
import { NotFoundError } from '../error';
import { PRIV } from '../model/builtin';
import PasteModel, { PasteDoc, PasteExpire, PasteMode } from '../model/paste';
import { Handler, param, Types } from '../service/server';

const PasteContent = Schema.string().min(1).max(65536);
const PasteTitle = Schema.string().max(64);
const PasteLanguage = Schema.string().pattern(/^[a-z0-9-]{0,64}$/i);

const EXPIRY_OPTIONS: Record<PasteExpire, string> = {
    day: '1 day',
    week: '1 week',
    month: '1 month',
    never: 'Never expire',
};

class PasteDocHandler extends Handler {
    noCheckPermView = true;

    pdoc?: PasteDoc;

    @param('id', Types.ShortString)
    async prepare(_domainId: string, id: string) {
        this.pdoc = await PasteModel.get(id);
        if (!this.pdoc) throw new NotFoundError(id);
    }
}

class PasteMainHandler extends Handler {
    noCheckPermView = true;

    @param('page', Types.PositiveInt, true)
    async get(_domainId: string, page = 1) {
        const [pdocs, ppcount, pcount] = await this.paginate(PasteModel.getMultiByOwner(this.user._id), page, 'paste');
        this.response.template = 'paste_main.html';
        this.response.body = {
            pdocs,
            ppcount,
            pcount,
            page,
            expiryOptions: EXPIRY_OPTIONS,
            defaultExpire: 'month',
        };
    }

    @param('title', PasteTitle, true)
    @param('mode', Types.Range(['code', 'markdown']))
    @param('language', PasteLanguage, true)
    @param('content', PasteContent)
    @param('expire', Types.Range(Object.keys(EXPIRY_OPTIONS)), true)
    async post(_domainId: string, title = '', mode: PasteMode = 'code', language = '', content = '', expire: PasteExpire = 'month') {
        await this.limitRate('add_paste', 3600, 60, '{{user}}');
        const pdoc = await PasteModel.add(this.user._id, {
            title,
            mode,
            language: mode === 'code' ? language : '',
            content,
            expire,
        });
        this.response.body = { id: pdoc._id };
        this.response.redirect = this.url('paste_detail', { id: pdoc._id });
    }
}

class PasteDetailHandler extends PasteDocHandler {
    @param('id', Types.ShortString)
    async get() {
        this.response.template = 'paste_detail.html';
        this.response.body = {
            pdoc: this.pdoc,
            canManage: this.user.own(this.pdoc) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
        };
        this.UiContext.extraTitleContent = this.pdoc.title || 'Pastebin';
    }
}

class PasteEditHandler extends PasteDocHandler {
    @param('id', Types.ShortString)
    async get() {
        if (!this.user.own(this.pdoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        this.response.template = 'paste_edit.html';
        this.response.body = { pdoc: this.pdoc, expiryOptions: EXPIRY_OPTIONS };
    }

    @param('id', Types.ShortString)
    @param('title', PasteTitle, true)
    @param('mode', Types.Range(['code', 'markdown']))
    @param('language', PasteLanguage, true)
    @param('content', PasteContent)
    @param('expire', Types.Range(Object.keys(EXPIRY_OPTIONS)), true)
    async postUpdate(
        _domainId: string, id: string, title = '', mode: PasteMode = 'code', language = '', content = '', expire: PasteExpire = 'month',
    ) {
        if (!this.user.own(this.pdoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await PasteModel.edit(id, {
            title,
            mode,
            language: mode === 'code' ? language : '',
            content,
            expire,
        });
        this.response.redirect = this.url('paste_detail', { id });
    }

    @param('id', Types.ShortString)
    async postDelete(_domainId: string, id: string) {
        if (!this.user.own(this.pdoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await PasteModel.del(id);
        this.response.redirect = this.url('paste_main');
    }
}

class PasteRawHandler extends PasteDocHandler {
    @param('id', Types.ShortString)
    async get() {
        this.response.type = 'text/plain';
        this.response.body = this.pdoc.content;
    }
}

export async function apply(ctx) {
    ctx.Route('paste_main', '/paste', PasteMainHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paste_edit', '/paste/:id/edit', PasteEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paste_raw', '/paste/:id/raw', PasteRawHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paste_detail', '/paste/:id', PasteDetailHandler, PRIV.PRIV_USER_PROFILE);
    ctx.injectUI('UserDropdown', 'paste_main', () => ({ icon: 'code', displayName: 'Pastebin' }), PRIV.PRIV_USER_PROFILE);
}

export {
    PasteContent, PasteDetailHandler, PasteDocHandler, PasteEditHandler, PasteMainHandler, PasteRawHandler,
};
