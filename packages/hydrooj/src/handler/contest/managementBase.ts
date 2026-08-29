import { PERM } from '../../model/builtin';
import { ContestDetailBaseHandler } from './base';

export class ContestManagementBaseHandler extends ContestDetailBaseHandler {
    async prepare() {
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_CONTEST);
    }
}
