import assert from 'assert';
import { writeFileSync } from 'fs';
import autocannon from 'autocannon';
import {
    after, before, describe, it,
} from 'node:test';
import * as supertest from 'supertest';

const Root = {
    username: 'root',
    password: '123456',
    creditionals: null,
};

describe('App', () => {
    let agent;
    before(async () => {
        const init = Date.now();
        await new Promise((resolve) => {
            process.send = ((send) => (data) => {
                console.log('send', data);
                if (data === 'ready') {
                    agent = supertest.agent(require('hydrooj').httpServer);
                    resolve(null);
                }
                return send?.(data) || false;
            })(process.send);
        });
        console.log('Application inited in %d ms', Date.now() - init);
    }, { timeout: 30000 });

    const routes = ['/', '/p', '/contest', '/homework', '/user/1', '/training'];
    for (const route of routes) {
        // eslint-disable-next-line ts/no-loop-func
        it(`GET ${route}`, () => agent.get(route).expect(200));
    }

    it('Anonymous check-in API state', async () => {
        const home = await agent.get('/').set('Accept', 'application/json').expect(200);
        assert.equal(home.body.checkin.timezone, 'UTC+08:00');
        assert.equal(home.body.checkin.canCheckin, false);
        assert.equal(home.body.checkin.record, null);
        assert.equal(home.body.checkin.streak, 0);

        const profile = await agent.get('/user/1').set('Accept', 'application/json').expect(200);
        assert.equal(profile.body.checkinHistory.timezone, 'UTC+08:00');
        assert.deepEqual(profile.body.checkinHistory.records, []);
        assert.equal(profile.body.checkinHistory.total, 0);

        const rejected = await agent.post('/checkin')
            .set('Accept', 'application/json')
            .send({ fortune: 'da_ji', uid: 1 })
            .expect(200);
        assert.match(rejected.body.url, /\/login/);
    });

    it('API user', async () => {
        await agent.get('/api/user?args={"id":1}&projection=uname').expect({ uname: 'Hydro' });
        await agent.get('/api/user?args={"id":2}&projection=uname').expect(null);
    });

    it('Create User', async () => {
        const redirect = await agent.post('/register')
            .send({ mail: 'test@example.com' })
            .expect(302)
            .then((res) => res.headers.location);
        await agent.post(redirect)
            .send({ uname: Root.username, password: Root.password, verifyPassword: Root.password })
            .expect(302);
        await global.Hydro.model.user.setById(2, { realnameStatus: 'approved' });
    });

    it('Login', async () => {
        const cookie = await agent.post('/login')
            .send({ uname: Root.username, password: Root.password })
            .expect(302)
            .then((res) => res.headers['set-cookie']);
        Root.creditionals = cookie;
    });

    it('Ranking JSON includes public user metrics', async () => {
        await global.Hydro.model.domain.updateUserInDomain('system', 2, {
            $set: {
                join: true,
                rp: 123,
                rpInfo: { contest: 23, problem: 100 },
            },
            $unset: { nAccept: '' },
        });

        let ranking = await agent.get('/ranking')
            .set('Accept', 'application/json')
            .expect(200);
        let rankedUser = ranking.body.udocs.find((udoc: { _id: number }) => udoc._id === 2);

        assert.ok(rankedUser);
        assert.equal(rankedUser.rp, 123);
        assert.deepEqual(rankedUser.rpInfo, { contest: 23, problem: 100 });
        assert.equal(rankedUser.nAccept, 0);

        await global.Hydro.model.domain.setUserInDomain('system', 2, { nAccept: 7 });
        ranking = await agent.get('/ranking')
            .set('Accept', 'application/json')
            .expect(200);
        rankedUser = ranking.body.udocs.find((udoc: { _id: number }) => udoc._id === 2);

        assert.ok(rankedUser);
        assert.equal(rankedUser.nAccept, 7);
    });

    it('Authenticated check-in API state', async () => {
        const home = await agent.get('/')
            .set('Accept', 'application/json')
            .expect(200);
        assert.equal(home.body.checkin.canCheckin, true);
        assert.equal(home.body.checkin.record, null);
        assert.equal(home.body.checkin.streak, 0);

        const now = new Date(`${home.body.checkin.date}T04:00:00+08:00`);
        const created = await global.Hydro.model.checkin.add(2, {
            clock: () => now,
            random: () => 0,
            fetchHitokoto: async () => ({
                id: 7338,
                uuid: '75a45fd4-4f2f-45eb-80cb-6f0a7bcdfaf2',
                text: '用代码表达言语的魅力。',
                type: 'f',
                from: '一言开发者中心',
                fromWho: null,
            }),
        });
        assert.equal(created.created, true);

        const checkedHome = await agent.get('/').set('Accept', 'application/json').expect(200);
        const profile = await agent.get('/user/2').set('Accept', 'application/json').expect(200);
        assert.equal(checkedHome.body.checkin.canCheckin, false);
        assert.equal(checkedHome.body.checkin.streak, 1);
        assert.equal('createdAt' in checkedHome.body.checkin.record, false);
        assert.equal('streak' in checkedHome.body.checkin.record, false);
        assert.deepEqual(profile.body.checkinHistory.records, [checkedHome.body.checkin.record]);
        assert.equal(profile.body.checkinHistory.total, 1);

        // Streak lives on the check-in doc; a second homepage read needs no cache rebuild.
        const againHome = await agent.get('/').set('Accept', 'application/json').expect(200);
        assert.equal(againHome.body.checkin.canCheckin, false);
        assert.equal(againHome.body.checkin.streak, 1);
        assert.deepEqual(againHome.body.checkin.record, checkedHome.body.checkin.record);
        assert.equal(
            (await global.Hydro.model.checkin.getByDate(2, checkedHome.body.checkin.date)).streak,
            1,
        );

        const repeated = await agent.post('/checkin')
            .set('Accept', 'application/json')
            .send({ date: '2000-01-01', fortune: 'da_xiong', uid: 1 })
            .expect(200);
        assert.equal(repeated.body.created, false);
        assert.equal(repeated.body.streak, 1);
        assert.deepEqual(repeated.body.record, checkedHome.body.checkin.record);
        assert.equal(await global.Hydro.model.document.count('system', 80, { owner: 2 }), 1);
    });

    it('API registered user', async () => {
        await agent.get('/api/user?args={"id":2}&projection=uname').expect({ uname: 'root' });
    });

    it('Paste pages are not stored in cache across sessions', async () => {
        const created = await agent.post('/paste')
            .set('Accept', 'application/json')
            .send({
                mode: 'code', language: 'cpp', content: 'secret-from-root\n', expire: 'never',
            })
            .expect(200);
        const id = created.body.id;
        assert.ok(id);

        const peer = supertest.agent(require('hydrooj').httpServer);
        const register = await peer.post('/register')
            .send({ mail: 'peer@example.com' })
            .expect(302)
            .then((res) => res.headers.location);
        await peer.post(register)
            .send({ uname: 'peer', password: '123456', verifyPassword: '123456' })
            .expect(302);
        const peerUser = await global.Hydro.model.user.getByUname('system', 'peer');
        await global.Hydro.model.user.setById(peerUser._id, { realnameStatus: 'approved' });

        const [rootList, peerList, rootDetail, peerDetail, rootEdit] = await Promise.all([
            agent.get('/paste').set('Accept', 'application/json').expect(200),
            peer.get('/paste').set('Accept', 'application/json').expect(200),
            agent.get(`/paste/${id}`).set('Accept', 'application/json').expect(200),
            peer.get(`/paste/${id}`).set('Accept', 'application/json').expect(200),
            agent.get(`/paste/${id}/edit`).set('Accept', 'application/json').expect(200),
        ]);
        for (const response of [rootList, peerList, rootDetail, peerDetail, rootEdit]) {
            assert.match(String(response.headers['cache-control'] || ''), /no-store/i);
        }
        assert.ok(rootList.body.pdocs.some((pdoc: { _id: string }) => pdoc._id === id));
        assert.ok(!peerList.body.pdocs.some((pdoc: { _id: string }) => pdoc._id === id));
        assert.equal(rootDetail.body.pdoc.content, 'secret-from-root\n');
        assert.equal(peerDetail.body.pdoc.content, 'secret-from-root\n');
        await peer.get(`/paste/${id}/edit`).set('Accept', 'application/json').expect(403);
    });

    it('Validates contest attendance for query and body problem mutations', async () => {
        const pid = await global.Hydro.model.problem.add(
            'system', 'CONTEST_CONTEXT_TEST', 'Contest context test', '', 2,
        );
        const tid = await global.Hydro.model.contest.add(
            'system', 'Contest context test', '', 2, 'acm',
            new Date(Date.now() - 60_000), new Date(Date.now() + 60_000), [pid],
        );
        const contestId = tid.toString();
        const requests = [
            agent.post(`/p/${pid}/submit?tid=${contestId}`).send({ lang: 'cc.cc17', code: 'int main() {}', pretest: false }),
            agent.post(`/p/${pid}/submit`).send({ lang: 'cc.cc17', code: 'int main() {}', pretest: false, tid: contestId }),
            agent.post(`/p/${pid}/hack/000000000000000000000000?tid=${contestId}`).send({ input: '1' }),
            agent.post(`/p/${pid}/hack/000000000000000000000000`).send({ input: '1', tid: contestId }),
        ];
        for (const request of requests) {
            // eslint-disable-next-line no-await-in-loop
            const response = await request.set('Accept', 'application/json').expect(403);
            assert.match(response.body.error.message, /haven't attended this contest yet/i);
        }
    });

    it('Expires accounts on access and only restores automatic bans', async () => {
        const username = 'expire-test';
        const password = '123456';
        const uid = await global.Hydro.model.user.create(
            'expire-test@example.com', username, password, undefined, '127.0.0.1',
        );
        const adminUid = await global.Hydro.model.user.create(
            'expiration-admin@example.com', 'expiration-admin', password, undefined, '127.0.0.1',
        );
        await global.Hydro.model.user.setSuperAdmin(adminUid);
        await supertest.agent(require('hydrooj').httpServer).get('/manage/user-expiration').expect(302);

        const adminAgent = supertest.agent(require('hydrooj').httpServer);
        await adminAgent.post('/login').send({ uname: 'expiration-admin', password }).expect(302);
        await adminAgent.get('/manage/user-expiration').expect(302).expect('Location', /\/user\/sudo/);
        await adminAgent.post('/user/sudo').send({ password }).expect(302);

        const list = await adminAgent.get('/manage/user-expiration?q=expire-test')
            .set('Accept', 'application/json').expect(200);
        assert.ok(list.body.udocs.some((udoc: { _id: number }) => udoc._id === uid));

        await adminAgent.post('/manage/user-expiration').set('Accept', 'application/json')
            .send({ operation: 'set', uids: [uid], expireDate: '2099-01-01' }).expect(200);
        const setExpiration = await global.Hydro.model.user.coll.findOne({ _id: uid });
        await adminAgent.post('/manage/user-expiration').set('Accept', 'application/json')
            .send({ operation: 'adjust', uids: [uid], days: 1 }).expect(200);
        const adjustedExpiration = await global.Hydro.model.user.coll.findOne({ _id: uid });
        assert.equal(adjustedExpiration.accountExpireAt.getTime() - setExpiration.accountExpireAt.getTime(), 86400000);
        await adminAgent.post('/manage/user-expiration').set('Accept', 'application/json')
            .send({ operation: 'clear', uids: [uid] }).expect(200);
        assert.equal((await global.Hydro.model.user.coll.findOne({ _id: uid })).accountExpireAt, undefined);
        const finiteUid = await global.Hydro.model.user.create(
            'finite-expire-test@example.com', 'finite-expire-test', password, undefined, '127.0.0.1',
        );
        await global.Hydro.model.user.updateAccountExpirations([{ uid: finiteUid, expireAt: new Date('2099-01-02') }]);
        const unlimitedAdjustment = await adminAgent.post('/manage/user-expiration').set('Accept', 'application/json')
            .send({ operation: 'adjust', uids: [uid, finiteUid], days: 1 });
        assert.ok(unlimitedAdjustment.status >= 400);
        assert.equal(unlimitedAdjustment.body.error.name, 'AccountExpirationRequiredError');
        assert.equal((await global.Hydro.model.user.coll.findOne({ _id: uid })).accountExpireAt, undefined);
        assert.equal(
            (await global.Hydro.model.user.coll.findOne({ _id: finiteUid })).accountExpireAt.toISOString(),
            '2099-01-02T00:00:00.000Z',
        );

        const missingUser = await adminAgent.post('/manage/user-expiration').set('Accept', 'application/json')
            .send({ operation: 'clear', uids: [uid, 2147483647] });
        assert.ok(missingUser.status >= 400);
        assert.equal((await global.Hydro.model.user.coll.findOne({ _id: uid })).accountExpireAt, undefined);

        const protectedResponse = await adminAgent.post('/manage/user-expiration').set('Accept', 'application/json')
            .send({ operation: 'set', uids: [adminUid], expireDate: '2099-01-01' });
        assert.ok(protectedResponse.status >= 400);

        const expiringAgent = supertest.agent(require('hydrooj').httpServer);
        await expiringAgent.post('/login').send({ uname: username, password }).expect(302);

        const beforeExpiration = await global.Hydro.model.user.coll.findOne({ _id: uid });
        await global.Hydro.model.user.updateAccountExpirations([{
            uid,
            expireAt: new Date(Date.now() - 1000),
        }]);
        assert.notEqual((await global.Hydro.model.user.coll.findOne({ _id: uid })).priv, 0);
        const expiredAccess = await expiringAgent.get('/home/security').set('Accept', 'application/json').expect(200);
        assert.match(expiredAccess.body.url, /\/login/);

        const expired = await global.Hydro.model.user.coll.findOne({ _id: uid });
        assert.equal(expired.priv, 0);
        assert.equal(expired.accountExpireRestorePriv, beforeExpiration.priv);
        assert.equal(await global.Hydro.model.token.getSessionListByUid(uid).then((sessions) => sessions.length), 0);
        assert.equal(await global.Hydro.model.user.enforceAccountExpiration(uid), true);
        const expiredAgain = await global.Hydro.model.user.coll.findOne({ _id: uid });
        assert.equal(expiredAgain.priv, 0);
        assert.equal(expiredAgain.accountExpireRestorePriv, beforeExpiration.priv);

        const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await global.Hydro.model.user.updateAccountExpirations([{ uid, expireAt: future }]);
        const restored = await global.Hydro.model.user.coll.findOne({ _id: uid });
        assert.equal(restored.priv, beforeExpiration.priv);
        assert.equal(restored.accountExpireRestorePriv, undefined);
        await expiringAgent.post('/login').send({ uname: username, password }).expect(302);

        await global.Hydro.model.user.ban(uid, 'Manual ban');
        await global.Hydro.model.user.updateAccountExpirations([{ uid, expireAt: null }]);
        const manuallyBanned = await global.Hydro.model.user.coll.findOne({ _id: uid });
        assert.equal(manuallyBanned.priv, 0);
        assert.equal(manuallyBanned.accountExpireRestorePriv, undefined);

        const loginExpiredUid = await global.Hydro.model.user.create(
            'login-expire-test@example.com', 'login-expire-test', password, undefined, '127.0.0.1',
        );
        await global.Hydro.model.user.updateAccountExpirations([{
            uid: loginExpiredUid,
            expireAt: new Date(Date.now() - 1000),
        }]);
        await supertest.agent(require('hydrooj').httpServer).post('/login')
            .send({ uname: 'login-expire-test', password }).expect(403);
        const loginExpired = await global.Hydro.model.user.coll.findOne({ _id: loginExpiredUid });
        assert.equal(loginExpired.priv, 0);
        assert.notEqual(loginExpired.accountExpireRestorePriv, undefined);
    });

    // TODO add more tests

    const results: Record<string, autocannon.Result> = {};
    if (process.env.BENCHMARK) {
        for (const route of routes) {
            it(`Performance test ${route}`, { timeout: 60000 }, async () => {
                const result = await autocannon({ url: `http://localhost:8888${route}` });
                assert(result.errors === 0, `test ${route} returns errors`);
                results[route] = result;
            });
        }
    }

    after(() => {
        if (process.env.BENCHMARK) {
            const metrics = Object.entries(results).map(([k, v]) => ({
                name: `Benchmark - ${k} - Req/sec`,
                unit: 'Req/sec',
                value: v.requests.average,
            }));
            writeFileSync('./benchmark.json', JSON.stringify(metrics, null, 2));
        }
        setTimeout(() => process.exit(), 1000);
    });
});
