import axios from 'axios';
import {
    Context, Handler, param, PERM, PermissionError, ProblemModel, SystemModel, Types, yaml,
} from 'hydrooj';

declare module 'hydrooj' {
    interface SystemKeys {
        'judgeserver.token': string;
    }
}

class ZSHFOJImportHandler extends Handler {
    async get() {
        this.response.template = 'problem_import_zshfoj.html';
    }

    @param('oj', Types.String)
    @param('pid', Types.String)
    async post(domainId: string, oj: string, pid: string) {
        const token = SystemModel.get('judgeserver.token');
        if (!token) throw new PermissionError();
        const target = `${oj}${pid}`;
        const { data } = await axios.get(`https://zshfoj.com/judge-server/problem?pid=${target}&token=${token}`);

        const existingProblem = await ProblemModel.get(domainId, data.pid);
        if (existingProblem) {
            this.response.redirect = `/p/${data.pid}`;
            return;
        }

        const npid = await ProblemModel.add(domainId, data.pid, data.title, data.content, this.user._id, data.tags, {
            difficulty: data.difficulty,
        });
        await ProblemModel.addTestdata(domainId, npid, 'config.yaml', Buffer.from(yaml.dump({
            type: 'remote_judge',
            subType: 'judgeclient',
            target,
            time: data.config.timeMin || 0,
            memory: data.config.memoryMin || 0,
        })));
        this.response.redirect = `/p/${data.pid}`;
    }
}

export async function apply(ctx: Context) {
    ctx.Route('problem_import_zshfoj', '/problem/import/zshfoj', ZSHFOJImportHandler, PERM.PERM_CREATE_PROBLEM);
    ctx.injectUI('ProblemAdd', 'problem_import_zshfoj', { icon: 'copy', text: 'From ZSHFOJ' });
    ctx.i18n.load('zh', {
        'From ZSHFOJ': '从 LVJ 导入',
    });
}
