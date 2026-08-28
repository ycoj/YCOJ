import { ObjectId } from 'mongodb';
import { SolutionNotFoundError } from '../error';
import bus from '../service/bus';
import * as document from './document';

const TYPE = document.TYPE_CONTEST_SOLUTION;
const PARENT = document.TYPE_CONTEST;

class ContestSolutionModel {
    static add(domainId: string, tid: ObjectId, owner: number, content: string) {
        return document.add(domainId, content, owner, TYPE, null, PARENT, tid, { reply: [], vote: 0 });
    }

    static async get(domainId: string, csid: ObjectId) {
        const doc = await document.get(domainId, TYPE, csid);
        if (!doc) throw new SolutionNotFoundError(domainId, csid);
        return doc;
    }

    static getMulti(domainId: string, tid: ObjectId) {
        return document.getMulti(domainId, TYPE, { parentType: PARENT, parentId: tid }).sort({ vote: -1, _id: -1 });
    }

    static edit(domainId: string, csid: ObjectId, content: string) {
        return document.set(domainId, TYPE, csid, { content });
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

    static reply(domainId: string, csid: ObjectId, owner: number, content: string) {
        return document.push(domainId, TYPE, csid, 'reply', content, owner);
    }

    static getReply(domainId: string, csid: ObjectId, csrId: ObjectId) {
        return document.getSub(domainId, TYPE, csid, 'reply', csrId);
    }

    static editReply(domainId: string, csid: ObjectId, csrId: ObjectId, content: string) {
        return document.setSub(domainId, TYPE, csid, 'reply', csrId, { content });
    }

    static delReply(domainId: string, csid: ObjectId, csrId: ObjectId) {
        return document.deleteSub(domainId, TYPE, csid, 'reply', csrId);
    }

    static async vote(domainId: string, csid: ObjectId, uid: number, value: number) {
        const doc = await this.get(domainId, csid);
        const before = await document.setStatus(domainId, TYPE, csid, uid, { vote: value }, null, 'before');
        let inc = value;
        if (before?.vote) inc -= before.vote;
        return inc ? document.inc(domainId, TYPE, csid, 'vote', inc) : doc;
    }

    static async getListStatus(domainId: string, csids: ObjectId[], uid: number) {
        const result: Record<string, { docId: ObjectId, vote: number }> = {};
        const res = await document.getMultiStatus(domainId, TYPE, { uid, docId: { $in: csids } })
            .project<any>({ docId: 1, vote: 1 }).toArray();
        for (const i of res) result[i.docId] = i;
        return result;
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
