# Contest solutions

Contest solutions are contest-scoped Markdown posts. Contest owners, maintainers, and users with `PERM_EDIT_CONTEST` may create, edit, and delete them at any time. Other users may read, reply, and vote after the contest ends; normal contest visibility and assignment rules still apply. Homework contests do not expose this feature.

## GET `/contest/:tid/solution` and `/contest/:tid/solution/:sid`

Request: `type Q={tid:ObjectId;page?:PositiveInt;sid?:ObjectId}`. The detail route selects one solution and verifies its contest parent. Response: `type R={tdoc:ContestDoc;tsdoc:ContestStatusDoc|null;csdocs:ContestSolutionDoc[];page:number;pcount:number;cscount:number;udict:Record<number,UserDoc>;cssdict:Record<string,{docId:ObjectId;vote:number}>;sid?:ObjectId;canManage:boolean}`. The page renders `contest_solution.html`; before completion non-managers receive `ContestNotEndedError`.

## POST `/contest/:tid/solution`

Operations: `submit` (`content`), `edit_solution` (`psid`, `content`), `delete_solution` (`psid`), `reply` (`psid`, `content`), `edit_reply` (`psid`, `psrid`, `content`), `delete_reply` (`psid`, `psrid`), and `upvote`/`downvote` (`psid`). Submit/edit/delete require contest management; reply/vote operations use the existing solution permissions. Responses are framework back responses; submit includes `{csid:ObjectId}`, votes include `{vote:number,user_vote:1|-1}`.

## GET `/contest/:tid/solution/:csid/raw` and `/contest/:tid/solution/:csid/:csrid/raw`

Returns the selected contest solution or reply as Markdown (`Content-Type: text/markdown`) with the same completion, visibility, homework, and parent-validation rules. Missing or cross-contest solution/reply IDs return not-found errors.
