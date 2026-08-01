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
    });

    it('Login', async () => {
        const cookie = await agent.post('/login')
            .send({ uname: Root.username, password: Root.password })
            .expect(302)
            .then((res) => res.headers['set-cookie']);
        Root.creditionals = cookie;
    });

    it('Authenticated check-in API state', async () => {
        const home = await agent.get('/')
            .set('Accept', 'application/json')
            .expect(200);
        assert.equal(home.body.checkin.canCheckin, true);
        assert.equal(home.body.checkin.record, null);

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
        assert.deepEqual(profile.body.checkinHistory.records, [checkedHome.body.checkin.record]);
        assert.equal(profile.body.checkinHistory.total, 1);

        const repeated = await agent.post('/checkin')
            .set('Accept', 'application/json')
            .send({ date: '2000-01-01', fortune: 'da_xiong', uid: 1 })
            .expect(200);
        assert.equal(repeated.body.created, false);
        assert.deepEqual(repeated.body.record, checkedHome.body.checkin.record);
        assert.equal(await global.Hydro.model.document.count('system', 80, { owner: 2 }), 1);
    });

    it('API registered user', async () => {
        await agent.get('/api/user?args={"id":2}&projection=uname').expect({ uname: 'root' });
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
        setTimeout(() => process.exit(0), 1000);
    });
});
