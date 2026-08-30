import type { KoaContext } from '@hydrooj/framework';
import { isAccountExpired } from '../../lib/accountExpiration';
import { PERM, PRIV } from '../../model/builtin';
import UserModel from '../../model/user';

export default async (ctx: KoaContext, next) => {
    // User Layer
    const { args, domain } = ctx.HydroContext;
    const domainId = domain ? args.domainId : 'system';
    let user = await UserModel.getById(domainId, ctx.session.uid, ctx.session.scope);
    if (!user) {
        ctx.session.uid = 0;
        ctx.session.scope = PERM.PERM_ALL.toString();
        user = await UserModel.getById(domainId, ctx.session.uid, ctx.session.scope);
    }
    if (user._id !== 0 && isAccountExpired(user._udoc.accountExpireAt)) {
        const expired = await UserModel.enforceAccountExpiration(user._id);
        if (expired) {
            ctx.session.uid = 0;
            ctx.session.scope = PERM.PERM_ALL.toString();
            ctx.session.sudo = null;
            ctx.session.sudoUid = null;
            ctx.session.recreate = true;
            user = await UserModel.getById(domainId, 0, ctx.session.scope);
        }
    }
    if (user._id === 0) delete user.viewLang;
    else if (!user._udoc.ip.includes(ctx.request.ip) && user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
        await UserModel.setById(user._id, { loginip: ctx.request.ip });
    }
    ctx.HydroContext.user = await user.private();
    await next();
};
