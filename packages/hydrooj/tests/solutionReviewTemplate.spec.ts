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
    paginator: { render: (page, count, qs) => `<a href="?page=2&${qs}">Next</a>` },
};
const publicSource = '{% import "components/comments_solution.html" as comments with context %}{{ comments.render(docs=docs, udict=udict) }}';

describe('solution review templates', () => {
    it('renders only featured and approved solutions expanded, retaining every body', () => {
        const html = env.renderString(publicSource, context);
        assert.equal((html.match(/<details /g) || []).length, 5);
        assert.equal((html.match(/<details[^>]*\sopen\b/g) || []).length, 2);
        assert.equal((html.match(/<\/details>/g) || []).length, 5);
        for (const doc of docs) assert.ok(html.includes(doc.content));
        if (process.env.SOLUTION_REVIEW_FIXTURE) fs.writeFileSync('/tmp/solution-public.html', html);
    });

    it('renders review choices, revisions, author unblocking, and preserved pagination filters', () => {
        const html = env.render('problem_solution_review.html', context);
        for (const state of [3, 2, 0, -1]) assert.ok(html.includes(`name="status" value="${state}"`));
        assert.ok(html.includes('name="revision" value="1"'));
        assert.ok(html.includes('name="operation" value="unblock"'));
        assert.ok(html.includes('status=all&amp;pid=1000&amp;uid=42'));
        if (process.env.SOLUTION_REVIEW_FIXTURE) fs.writeFileSync('/tmp/solution-review.html', html);
    });

    it('replaces the composer with an explanation for blocked authors', () => {
        const html = env.renderString(publicSource, { ...context, solutionBlocked: true });
        assert.ok(html.includes('Your solution submissions are blocked in this domain.'));
        assert.ok(!html.includes('name="dczcomments__dummy-box"'));
        assert.ok(html.includes('dczcomments__reply commentbox-container')); // Replies remain available.
    });
});
