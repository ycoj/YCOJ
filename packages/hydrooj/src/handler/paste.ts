import { NotFoundError } from '../error';
import { PRIV } from '../model/builtin';
import PasteModel, {
    LANGUAGE_OPTIONS, languageOptionsFor, PasteContent, PasteDoc, PasteExpire, PasteLanguage, PasteMode, PasteTitle,
    pasteWriteData,
} from '../model/paste';
import { Handler, param, Types } from '../service/server';

const EXPIRY_OPTIONS: Record<PasteExpire, string> = {
    day: '1 day',
    week: '1 week',
    month: '1 month',
    never: 'Never expire',
};

function pasteFields(target: object, key: string, desc: PropertyDescriptor) {
    param('expire', Types.Range(Object.keys(EXPIRY_OPTIONS)), true)(target, key, desc);
    param('content', PasteContent)(target, key, desc);
    param('language', PasteLanguage, true)(target, key, desc);
    param('mode', Types.Range(['code', 'markdown']))(target, key, desc);
    param('title', PasteTitle, true)(target, key, desc);
    return desc;
}

class PasteDocHandler extends Handler {
    pdoc?: PasteDoc;

    @param('id', Types.ShortString)
    async __prepare(_domainId: string, id: string) {
        this.pdoc = await PasteModel.get(id);
        if (!this.pdoc) throw new NotFoundError(id);
    }
}

class PasteMainHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    async get(_domainId: string, page = 1) {
        this.response.addHeader('Cache-Control', 'no-store');
        const [pdocs, ppcount, pcount] = await this.paginate(PasteModel.getMultiByOwner(this.user._id), page, 'paste');
        this.response.template = 'paste_main.html';
        this.response.body = {
            pdocs,
            ppcount,
            pcount,
            page,
            expiryOptions: EXPIRY_OPTIONS,
            languageOptions: LANGUAGE_OPTIONS,
            defaultExpire: 'month',
            defaultLanguage: 'cpp',
        };
    }

    @pasteFields
    async post(_domainId: string, title = '', mode: PasteMode = 'code', language = '', content = '', expire: PasteExpire = 'month') {
        await this.limitRate('add_paste', 3600, 60, '{{user}}');
        const pdoc = await PasteModel.add(this.user._id, pasteWriteData(title, mode, language, content, expire));
        this.response.body = { id: pdoc._id };
        this.response.redirect = this.url('paste_detail', { id: pdoc._id });
    }
}

class PasteDetailHandler extends PasteDocHandler {
    @param('id', Types.ShortString)
    async get() {
        this.response.addHeader('Cache-Control', 'no-store');
        this.response.template = 'paste_detail.html';
        this.response.body = {
            pdoc: this.pdoc,
            canManage: this.user.own(this.pdoc) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
            languageNames: LANGUAGE_OPTIONS,
        };
        this.UiContext.extraTitleContent = this.pdoc.title || this.translate('Pastebin');
    }
}

class PasteEditHandler extends PasteDocHandler {
    async prepare() {
        if (!this.user.own(this.pdoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    @param('id', Types.ShortString)
    async get() {
        this.response.addHeader('Cache-Control', 'no-store');
        this.response.template = 'paste_edit.html';
        this.response.body = {
            pdoc: this.pdoc,
            expiryOptions: EXPIRY_OPTIONS,
            languageOptions: languageOptionsFor(this.pdoc.language),
            defaultExpire: 'month',
            defaultLanguage: 'cpp',
        };
    }

    @param('id', Types.ShortString)
    @pasteFields
    async postUpdate(
        _domainId: string, id: string, title = '', mode: PasteMode = 'code', language = '', content = '', expire: PasteExpire = 'month',
    ) {
        await PasteModel.edit(id, pasteWriteData(title, mode, language, content, expire));
        this.response.redirect = this.url('paste_detail', { id });
    }

    @param('id', Types.ShortString)
    async postDelete(_domainId: string, id: string) {
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
