import {
    Context, db, ObjectId,
} from 'hydrooj';
import JudgeClientProvider from './provider';

declare module 'hydrooj' {
    interface Model {
        judgeclient: {
            addAccount: typeof addAccount;
        };
    }
}

async function addAccount(token: string) {
    // eslint-disable-next-line ts/no-unused-vars
    const provider = new JudgeClientProvider({
        _id: 'test', type: 'judgeclient', handle: '', password: token,
    }, async () => { });

    await db.collection('vjudge').insertOne({
        _id: new ObjectId().toHexString(),
        handle: '',
        password: token,
        type: 'judgeclient',
    });
    return 'success';
}

global.Hydro.model.judgeclient = {
    addAccount,
};

export async function apply(ctx: Context) {
    ctx.inject(['vjudge'], (c) => {
        // @ts-ignore
        c.vjudge.addProvider('judgeclient', JudgeClientProvider);
    });
}
