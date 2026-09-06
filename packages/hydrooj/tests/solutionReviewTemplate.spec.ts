import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { describe, it } from 'node:test';
import nunjucks from 'nunjucks';

const templates = path.resolve(__dirname, '../../ui-default/templates');
const stubs = {
    'layout/basic.html': '{% block content %}{% endblock %}',
    'components/user.html': '{% macro render_inline(user) %}Author {{ user._id }}{% endmacro %}',
};
class Loader extends nunjucks.Loader {
    getSource(name: string) {
        return { src: stubs[name] || fs.readFileSync(path.join(templates, name), 'utf8'), path: name, noCache: true };
    }
}
const env = new nunjucks.Environment(new Loader(), { autoescape: true });
env.addFilter('json', JSON.stringify);
env.addFilter('markdown', (s) => `<p>${nunjucks.lib.escape(s)}</p>`);
const reviewLabels = { 3: 'Featured Solution', 2: 'Approved', 1: 'Unreviewed', 0: 'Rejected', '-1': 'Rejected and author blocked' };
const docs = [3, 2, 1, 0, -1].map((reviewStatus, i) => ({
    _id: `id${i}`, docId: `id${i}`, parentId: 1000, owner: 42, reviewStatus, revision: 1,
    content: `Solution body ${reviewStatus}`, vote: 0, reply: [],
}));
const context = {
    _: (s) => s,
    url: (name, args = {}) => `/${name}?${new URLSearchParams(args).toString()}`,
    datetimeSpan: () => 'today',
    handler: { user: { hasPerm: () => true, own: () => true } },
    udict: { 42: { _id: 42 } }, pdict: { 1000: { title: 'Problem' } },
    pdoc: { docId: 1000 }, pssdict: {}, perm: {},
    reviewLabels, docs, status: 'all', page: 1, pcount: 2, pid: 1000, uid: 42,
    stats: { totalSolutions: 12, newToday: 3, pendingReview: 5 },
    paginator: { render: (page, count, qs) => `<a href="?page=2&${qs}">Next</a>` },
};
const publicSource = '{% import "components/comments_solution.html" as comments with context %}{{ comments.render(docs=docs, udict=udict) }}';

describe('solution review templates', () => {
    it('groups all unapproved entries, including metadata and replies, in one closed disclosure', () => {
        const html = env.renderString(publicSource, context);
        assert.equal((html.match(/<details /g) || []).length, 1);
        assert.equal((html.match(/<details[^>]*\sopen\b/g) || []).length, 0);
        assert.equal((html.match(/<\/details>/g) || []).length, 1);
        const folded = html.match(/<details[\s\S]*?<\/details>/)[0];
        assert.ok(folded.includes('solution-list__count">3</span>'));
        for (const doc of docs) {
            assert.equal(folded.includes(`data-solution-id="${doc._id}"`), doc.reviewStatus < 2);
            assert.equal(folded.includes(doc.content), doc.reviewStatus < 2);
            assert.equal((html.match(new RegExp(`data-solution-id="${doc._id}"`, 'g')) || []).length, 1);
        }
        const withReply = env.renderString(publicSource, {
            ...context, docs: [{ ...docs[2], reply: [{ _id: 'reply1', owner: 42, content: 'Unapproved reply' }] }],
        });
        const foldedWithReply = withReply.match(/<details[\s\S]*?<\/details>/)[0];
        for (const content of ['Author 42', 'vote-op', 'Unapproved reply', 'data-op="edit"']) {
            assert.ok(foldedWithReply.includes(content));
        }
        if (process.env.SOLUTION_REVIEW_FIXTURE) fs.writeFileSync('/tmp/solution-public.html', html);
    });

    it('omits the disclosure for approved-only and empty lists', () => {
        for (const entries of [docs.slice(0, 2), []]) {
            const html = env.renderString(publicSource, { ...context, docs: entries });
            assert.ok(!html.includes('<details'));
            for (const doc of entries) assert.ok(html.includes(doc.content));
        }
    });

    it('keeps unapproved permalinks wholly collapsed and groups mixed input correctly', () => {
        for (const entries of [[docs[4]], docs.slice(2), [...docs].reverse()]) {
            const html = env.renderString(publicSource, { ...context, docs: entries, sid: entries[0]._id });
            assert.equal((html.match(/<details /g) || []).length, 1);
            assert.ok(!/<details[^>]*\sopen\b/.test(html));
            for (const doc of entries) assert.ok(html.includes(doc.content));
            if (entries.length === 5) assert.ok(html.indexOf('Solution body 2') < html.indexOf('<details'));
        }
    });

    it('renders the two-column workbench: overview stats, content, info, and actions for the current solution', () => {
        const html = env.render('problem_solution_review.html', context);
        assert.ok(html.includes('Solution Data Overview'));
        assert.match(html, /Total Solutions<\/dt>\s*<dd>12<\/dd>/);
        assert.match(html, /New Solutions Today<\/dt>\s*<dd>3<\/dd>/);
        assert.match(html, /Pending Review<\/dt>\s*<dd>5<\/dd>/);
        assert.ok(html.includes('Solution Content'));
        assert.ok(html.includes('Solution body 3'));
        assert.ok(!html.includes('Solution body 2')); // Only the current item is reviewed at a time.
        assert.ok(html.includes('Problem / User Info'));
        assert.ok(!html.includes('<form method="get"')); // Filter form removed; the queue walks pending solutions one by one.
        assert.ok(html.includes('name="revision" value="1"'));
        assert.ok(html.includes('problem_solution_detail'));
        for (const state of [3, 2, 0, -1]) assert.ok(html.includes(`name="status" value="${state}"`));
        assert.ok(!html.includes('name="operation" value="unblock"'));
        if (process.env.SOLUTION_REVIEW_FIXTURE) fs.writeFileSync('/tmp/solution-review.html', html);
    });

    it('renders author unblocking in the actions column of the authors view', () => {
        const authorsDoc = {
            uid: 42, domainId: 'Demo', solutionBlocked: true, solutionBlockedBy: 99, solutionBlockedAt: new Date(),
        };
        const html = env.render('problem_solution_review.html', {
            ...context, status: 'authors', docs: [authorsDoc], pdict: {}, udict: { 42: { _id: 42 }, 99: { _id: 99 } },
        });
        assert.ok(html.includes('name="operation" value="unblock"'));
        assert.ok(html.includes('name="uid" value="42"'));
        assert.ok(html.includes('Author 99'));
        assert.ok(html.includes('Blocked solution authors'));
        assert.ok(html.includes('>Solution Review</a>')); // Back link to the review queue.
    });

    it('replaces the composer with an explanation for blocked authors', () => {
        const html = env.renderString(publicSource, { ...context, solutionBlocked: true });
        assert.ok(html.includes('Your solution submissions are blocked in this domain.'));
        assert.ok(!html.includes('name="dczcomments__dummy-box"'));
        assert.ok(html.includes('dczcomments__reply commentbox-container')); // Replies remain available.
    });
});
