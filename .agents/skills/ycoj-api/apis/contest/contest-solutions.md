# Contest solutions

Contest solutions are contest-scoped Markdown articles with a title and body. Contest owners, maintainers, and users with `PERM_EDIT_CONTEST` may create, edit, and delete them at any time. Other users may read them after the contest ends; normal contest visibility and assignment rules still apply. Homework contests do not expose this feature. There is no contest-nav item for solutions.

## GET `/contest/:tid`

When the caller may view solutions (`PERM_EDIT_CONTEST`, contest owner/maintainer, or the contest is done), the contest-detail payload includes `csdocs` (title, `docId`, `owner`), `canManage`, `showContestSolutions: true`, and `udict` entries for each solution author. HTML `contest_detail.html` renders a compact table (title, author, time; one row per solution) under the contest introduction; each title links to that solution's page. Managers also get a create button in the section header. Users without access receive the normal detail payload and do not see the section.

## GET/POST `/contest/:tid/solution/create` and `/contest/:tid/solution/:sid/edit`

Managers only. GET renders `contest_solution_edit.html` with `{ tdoc, tsdoc, csdoc, canManage:true }`; create uses an empty `csdoc`. POST body `{ title:Title, content:Content }` creates or updates the article and redirects to `/contest/:tid/solution/:sid` with `{ sid:ObjectId }`. On the edit route, `operation: "delete"` removes the article and redirects to contest detail.

## GET/POST `/contest/:tid/solution/:sid`

Request: `type Q={tid:ObjectId;sid:ObjectId}`. Response: `type R={tdoc:ContestDoc;tsdoc:ContestStatusDoc|null;csdoc:ContestSolutionDoc;canManage:boolean;udict:Record<number,UserDoc>}`. HTML `contest_solution_detail.html` shows title and Markdown content. Before completion non-managers receive `ContestNotEndedError`. Missing or cross-contest IDs return not-found errors. POST `operation: "delete"` is manager-only and redirects to contest detail.
