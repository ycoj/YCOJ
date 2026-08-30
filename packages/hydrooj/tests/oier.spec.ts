import assert from 'assert';
import { describe, it } from 'node:test';
import { checkBind } from '../src/lib/oier/bind';
import { computeCcf } from '../src/lib/oier/ccf';
import { ccfHookSrc, ccfHookTier } from '../src/lib/oier/hook';
import { recordFingerprint } from '../src/lib/oier/merge';
import { parseOierData } from '../src/lib/oier/parse';
import { buildSchoolAliasIndex, schoolsMatch } from '../src/lib/oier/schoolMatch';
import type { OierRecord } from '../src/lib/oier/types';

const contestsJson = JSON.stringify([
    {
        name: 'NOIP2017提高', type: 'NOIP提高', year: 2017, fall_semester: true, full_score: 600, capacity: 100,
    },
    {
        name: 'NOI2019', type: 'NOI', year: 2019, fall_semester: false, full_score: 600,
    },
    {
        name: 'CSP2020提高', type: 'CSP提高', year: 2020, fall_semester: true, full_score: 600, capacity: 50,
    },
    {
        name: 'NOI2000', type: 'NOI', year: 2000, fall_semester: false, full_score: 600,
    },
]);

const schoolTxt = [
    '湖南,长沙,湖南师范大学附属中学,湖南师大附中,师大附中',
    '湖南,长沙,长沙市雅礼中学,雅礼',
    '江苏,南京,南京外国语学校,南外',
].join('\n');

const rawTxt = [
    'NOIP2017提高,一等奖,张三,初三,师大附中,500,湖南,男,',
    'NOI2019,金牌,张三,高一,雅礼,522,湖南,男,',
    'CSP2020提高,一等奖,李四,高二,南外,480,江苏,男,',
    'NOI2000,铜牌,王五,高三,南外,300,江苏,男,',
    'CSP2020提高,二等奖,王五,高二,雅礼,200,湖南,男,',
].join('\n');

function parse() {
    return parseOierData({ schoolTxt, contestsJson, rawTxt });
}

describe('oier parser', () => {
    it('loads schools and aliases', () => {
        const parsed = parse();
        assert.equal(parsed.schools.length, 3);
        assert.ok(parsed.schools.some((s) => s.aliases.includes('师大附中')));
    });

    it('keeps empty school rows as id placeholders', () => {
        const parsed = parseOierData({
            schoolTxt: '湖南,长沙,一中\n,,\n湖南,长沙,二中\n',
            contestsJson: '[]',
            rawTxt: '',
        });
        assert.equal(parsed.schools.length, 3);
        assert.equal(parsed.schools[1].name, '');
        assert.equal(parsed.schools[2].id, 2);
        assert.equal(parsed.schools[2].name, '二中');
    });

    it('parses nine-column raw rows', () => {
        const parsed = parse();
        const zhang = parsed.oiers.find((o) => o.name === '张三');
        assert.ok(zhang);
        assert.equal(zhang.records.length, 2);
        assert.ok(zhang.records.some((r) => r.contestName === 'NOI2019' && r.award === '金牌' && r.rank === 1));
    });

    it('merges same-name records across schools after promotion', () => {
        const parsed = parse();
        const matches = parsed.oiers.filter((o) => o.name === '张三');
        assert.equal(matches.length, 1);
        assert.ok(matches[0].schools.includes('湖南师范大学附属中学'));
        assert.ok(matches[0].schools.includes('长沙市雅礼中学'));
        assert.equal(matches[0].latestSchool, '长沙市雅礼中学');
        assert.equal(matches[0].ccfLevel, 10);
    });

    it('does not merge namesakes far apart in time', () => {
        const parsed = parse();
        const wang = parsed.oiers.filter((o) => o.name === '王五');
        assert.ok(wang.length >= 2);
    });

    it('assigns CSP-S top-10% as CCF 7', () => {
        const parsed = parse();
        const li = parsed.oiers.find((o) => o.name === '李四');
        assert.ok(li);
        assert.equal(li.ccfLevel, 7);
        assert.equal(li.records[0].rank, 1);
    });

    it('skips malformed raw lines', () => {
        const parsed = parseOierData({
            schoolTxt,
            contestsJson,
            rawTxt: `${rawTxt}\nbadline\n`,
        });
        assert.ok(parsed.warnings.some((w) => w.message.includes('格式错误')));
    });
});

describe('ccf and hook', () => {
    it('maps NOI medals to CCF 8-10', () => {
        const contest = {
            id: 0, name: 'NOI', type: 'NOI', year: 2019, fallSemester: false, fullScore: 600,
            contestants: [] as OierRecord[], levelCounts: new Map<string, number>(),
        };
        const record = {
            id: 1, name: 'A', identifier: '', contest, score: 500, rank: 1, level: '金牌',
            grades: 0n, gradeName: '高一', school: {
                id: 0, name: 'S', province: '湖南', city: '长沙', aliases: [],
            },
            province: '湖南', gender: 1, ems: new Map(), keepGrade: false,
        };
        contest.contestants.push(record as OierRecord);
        assert.equal(computeCcf([record as OierRecord]).ccfLevel, 10);
        record.level = '银牌';
        assert.equal(computeCcf([record as OierRecord]).ccfLevel, 9);
        record.level = '铜牌';
        assert.equal(computeCcf([record as OierRecord]).ccfLevel, 8);
    });

    it('selects hook colors by CCF level', () => {
        assert.equal(ccfHookTier(0), null);
        assert.equal(ccfHookTier(2), null);
        assert.equal(ccfHookTier(3), 'green');
        assert.equal(ccfHookTier(5), 'green');
        assert.equal(ccfHookTier(6), 'blue');
        assert.equal(ccfHookTier(8), 'blue');
        assert.equal(ccfHookTier(9), 'gold');
        assert.equal(ccfHookTier(10), 'gold');
        assert.equal(ccfHookSrc('green'), 'img/ccf-hook-green.png');
        assert.equal(ccfHookSrc('blue'), 'img/ccf-hook-blue.png');
        assert.equal(ccfHookSrc('gold'), 'img/ccf-hook-gold.png');
    });
});

describe('school match and bind checks', () => {
    it('matches official names and aliases', () => {
        const index = buildSchoolAliasIndex([
            { name: '湖南师范大学附属中学', aliases: ['湖南师大附中', '师大附中'] },
        ]);
        assert.equal(schoolsMatch('湖南师大附中', '湖南师范大学附属中学', index), true);
        assert.equal(schoolsMatch('师大附中', '湖南师范大学附属中学', index), true);
        assert.equal(schoolsMatch('长沙市雅礼中学', '湖南师范大学附属中学', index), false);
    });

    it('rejects bind when the name differs or the slot is taken', () => {
        assert.equal(checkBind(null, '张三', null), 'missing');
        assert.equal(checkBind({ name: '张三' }, '张三', 12), 'already');
        assert.equal(checkBind({ name: '李四' }, '张三', null), 'mismatch');
        assert.equal(checkBind({ name: '张三', uid: 8 }, '张三', null), 'taken');
        assert.equal(checkBind({ name: '张三' }, '张三', null), null);
    });

    it('builds a stable record fingerprint', () => {
        assert.equal(
            recordFingerprint({
                contestName: 'NOI2019', name: '张三', school: '雅礼', score: 522, rank: 1, award: '金牌', province: '湖南',
            }),
            'NOI2019|张三|雅礼|522|1|金牌|湖南',
        );
    });
});
