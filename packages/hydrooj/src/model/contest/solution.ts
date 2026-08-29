import { ObjectId } from 'mongodb';
import { NotFoundError, SolutionNotFoundError } from '../../error';
import type { Tdoc, User } from '../../interface';
import bus from '../../service/bus';
import { PERM } from '../builtin';
import * as document from '../document';
import { isDone } from './common';

const TYPE = document.TYPE_CONTEST_SOLUTION;
const PARENT = document.TYPE_CONTEST;

class ContestSolutionModel {
    static isManager(user: User, tdoc: Tdoc) {
        return user.own(tdoc) || user.hasPerm(PERM.PERM_EDIT_CONTEST);
    }

    static canManageOrDone(user: User, tdoc: Tdoc) {
        return this.isManager(user, tdoc) || isDone(tdoc);
    }

    static ensureParent(doc: any, tid: ObjectId, domainId: string) {
        if (!doc || doc.parentType !== PARENT || !doc.parentId || doc.parentId.toString() !== tid.toString()) {
            throw new NotFoundError(domainId, tid);
        }
    }

    static add(domainId: string, tid: ObjectId, owner: number, title: string, content: string) {
        return document.add(domainId, content, owner, TYPE, null, PARENT, tid, { title });
    }

    static async get(domainId: string, csid: ObjectId) {
        const doc = await document.get(domainId, TYPE, csid);
        if (!doc) throw new SolutionNotFoundError(domainId, csid);
        return doc;
    }

    static getMulti(domainId: string, tid: ObjectId) {
        return document.getMulti(domainId, TYPE, { parentType: PARENT, parentId: tid }).sort({ _id: -1 });
    }

    static edit(domainId: string, csid: ObjectId, title: string, content: string) {
        return document.set(domainId, TYPE, csid, { title, content });
    }

    static async del(domainId: string, csid: ObjectId) {
        return Promise.all([
            document.deleteOne(domainId, TYPE, csid),
            document.deleteMultiStatus(domainId, TYPE, { docId: csid }),
        ]);
    }

    static count(domainId: string, tid: ObjectId) {
        return document.count(domainId, TYPE, { parentType: PARENT, parentId: tid });
    }
}

bus.on('contest/del', async (domainId, tid) => {
    const docs = await document.getMulti(domainId, TYPE, { parentType: PARENT, parentId: tid })
        .project({ docId: 1 }).toArray();
    const ids = docs.map((doc) => doc.docId);
    if (!ids.length) return;
    await Promise.all([
        document.deleteMulti(domainId, TYPE, { docId: { $in: ids } }),
        document.deleteMultiStatus(domainId, TYPE, { docId: { $in: ids } }),
    ]);
});

export default ContestSolutionModel;
global.Hydro.model.contestSolution = ContestSolutionModel;
