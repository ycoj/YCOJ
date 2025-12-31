import { PERM, PRIV } from '@hydrooj/common';
import { Context } from '../context';
import user from '../model/user';
import { Handler } from '../service/server';

export class NavHandler extends Handler {
    async get({ domainId }) {
        this.response.body.navItems = global.Hydro.ui.getNodes('Nav').filter((x) => x.checker(this));
        this.response.body.user = await user.getById(domainId, this.user._id);
        this.response.body.user.modType = this.user.hasPriv(PRIV.PRIV_MOD_BADGE) ? 'su' : this.user.hasPerm(PERM.PERM_MOD_BADGE) ? 'mod' : null;
    }
}

export async function apply(ctx: Context) {
    ctx.Route('ui_nav', '/ui/nav', NavHandler);
}
