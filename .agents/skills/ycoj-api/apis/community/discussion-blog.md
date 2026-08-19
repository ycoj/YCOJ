# Discussion and blog endpoint contracts

Session/bearer authentication follows the shared base layer. `HTML` is a template response; `Redirect` means 302 or JSON `{url:string}` with `Accept: application/json`.

## `GET /discuss` and `GET /discuss/:type/:name`
Description: list all discussions or a vnode. Requests `type ListQuery={page?:number;all?:boolean}` example `GET /discuss?page=1`; `type NodePath={type:string;name:string}` example `/discuss/problem/1000?page=1`. Response `HTML`, example `…discussion_main…`; list requires `PERM_VIEW_DISCUSSION`, node visibility is checked.

## `GET|POST /discuss/:type/:name/create`
Description: form/create discussion. GET `type Path={type:string;name:string}`, example `GET /discuss/problem/1000/create`, response `HTML`. POST `type Input={type:string;title:string;content:string;highlight:boolean;pin:boolean}`, example `{"type":"problem","title":"Question","content":"Help","highlight":false,"pin":false}`, response `Redirect`, example `{"url":"/discuss/…"}`. Requires profile privilege + `PERM_CREATE_DISCUSSION`.

## `GET|POST /discuss/:did` and `/discuss/:did/edit`
Description: read/mutate a thread or edit it. GET `type Path={did:string};type Query={page?:number}`, example `GET /discuss/66aa?page=1`, response `HTML`. POST detail uses operation-specific validated fields: `type ThreadOp={operation:string;did?:string;drid?:string;drrid?:string;content?:string;emoji?:string;lock?:boolean;star?:boolean}`, example `{"operation":"reply","did":"66aa…","content":"Thanks"}`; edit input `type Edit={did:string;title:string;content:string;highlight:boolean;pin:boolean}`, example `{"did":"66aa…","title":"Updated","content":"Text","highlight":false,"pin":false}`. Responses `Redirect`, example `{"url":"/discuss/66aa…"}`; ownership/moderation permissions apply.

### Detail POST operations

Description: every detail mutation first requires profile privilege. `postSetLock` input `type SetLock={operation:"setLock";did:string;lock:boolean}`, example `{"operation":"setLock","did":"66aa…","lock":true}`; response `Redirect`, example `{"url":"/discuss/66aa…"}`; owner or `PERM_LOCK_DISCUSSION`.

`postReaction` input `type Reaction={operation:"reaction";nodeType:"did"|"drid";id:string;emoji:string;reverse?:boolean}`, example `{"operation":"reaction","nodeType":"did","id":"66aa…","emoji":"👍","reverse":false}`; response `type ReactionResult={doc:unknown;sdoc:unknown}` plus redirect, example `{"url":"/discuss/66aa…"}`; needs `PERM_ADD_REACTION`.

`postReply` input `type Reply={operation:"reply";did:string;content:string}`, example `{"operation":"reply","did":"66aa…","content":"Thanks"}`; response `Redirect`, example `{"url":"/discuss/66aa…?drid=66bb…"}`; needs `PERM_REPLY_DISCUSSION`, unlocked thread, and rate limit. `postTailReply` input `type TailReply={operation:"tailReply";drid:string;content:string}`, example `{"operation":"tailReply","drid":"66bb…","content":"Follow-up"}`; response `Redirect`, example `{"url":"/discuss/66aa…"}`; same permission/rate limit.

`postEditReply` input `type EditReply={operation:"editReply";drid:string;content:string}`, example `{"operation":"editReply","drid":"66bb…","content":"Corrected"}`; response `Redirect`, example `{"url":"/discuss/66aa…"}`; author + `PERM_EDIT_DISCUSSION_REPLY_SELF`. `postDeleteReply` input `type DeleteReply={operation:"deleteReply";drid:string}`, example `{"operation":"deleteReply","drid":"66bb…"}`; response `Redirect`, example `{"url":"/discuss/66aa…"}`; owner/thread-owner/moderator permission checks.

`postEditTailReply` input `type EditTail={operation:"editTailReply";drid:string;drrid:string;content:string}`, example `{"operation":"editTailReply","drid":"66bb…","drrid":"66cc…","content":"Corrected"}`; response `Redirect`, example `{"url":"/discuss/66aa…"}`. `postDeleteTailReply` input `type DeleteTail={operation:"deleteTailReply";drid:string;drrid:string}`, example `{"operation":"deleteTailReply","drid":"66bb…","drrid":"66cc…"}`; response `Redirect`, example `{"url":"/discuss/66aa…"}`. Both require reply ownership/self-delete or moderation permission. `postStar` input `type Star={operation:"star";did:string;star?:boolean}`, example `{"operation":"star","did":"66aa…","star":true}`; response `Redirect`, example `{"url":"/discuss/66aa…?star=true"}`.

### Edit POST operations

`postUpdate` input `type Update={operation:"update";did:string;title:string;content:string;highlight?:boolean;pin?:boolean}`, example `{"operation":"update","did":"66aa…","title":"Updated","content":"Text"}`; response `type Redirect={url:string}`, example `{"url":"/discuss/66aa…"}`; requires self edit or `PERM_EDIT_DISCUSSION`. `postDelete` input `type Delete={operation:"delete";did:string}`, example `{"operation":"delete","did":"66aa…"}`; response `Redirect`, example `{"url":"/discuss"}`; requires self-delete or `PERM_DELETE_DISCUSSION`.

## Raw discussion variants
Description: retrieve original Markdown. `GET /discuss/:did/raw`, `/:did/:drid/raw`, `/:did/:drid/:drrid/raw`; request `type Raw={did?:string;drid?:string;drrid?:string;time?:number;all?:boolean}`, example `GET /discuss/66aa/raw?time=1`. Response `type Source=string`, example `"Original **Markdown**"` as plain text; visibility checks apply.

## Blog routes
Description: optional blog package pages. `GET /blog/:uid` request `type BlogList={uid:number;page?:number}`, example `/blog/12?page=1`, response `HTML`. `GET|POST /blog/:uid/:did` displays/mutates its discussion, request `type BlogThread={uid:number;did:string}&ThreadOp`, example `{"operation":"reply","content":"Nice"}`, response `HTML|Redirect`. `GET|POST /blog/:uid/create` input `type BlogCreate={title:string;content:string}`, example `{"title":"Post","content":"Text"}`, response `HTML|Redirect`; `GET|POST /blog/:uid/:did/edit` input `type BlogEdit={did:string;title:string;content:string}`, example `{"did":"66aa…","title":"Post","content":"Edit"}`, response `HTML|Redirect`. Create/edit needs profile privilege; detail mutation checks author/moderator access.

Blog detail operations are exactly `postStar` (`type Star={operation:"star";did:string}`, example `{"operation":"star","did":"66aa…"}`, response `Redirect` example `{"url":"/blog/12/66aa…?star=true"}`) and `postUnstar` (`type Unstar={operation:"unstar";did:string}`, example `{"operation":"unstar","did":"66aa…"}`, response `Redirect` example `{"url":"/blog/12/66aa…?star=false"}`); profile privilege required. Blog edit operations are `postCreate` (`type Create={operation:"create";title:string;content:string}`, example `{"operation":"create","title":"Post","content":"Text"}`, response `Redirect` example `{"url":"/blog/12/66aa…"}`), `postUpdate` (`type Update={operation:"update";did:string;title:string;content:string}`, example `{"operation":"update","did":"66aa…","title":"Post","content":"Edit"}`, response same redirect), and `postDelete` (`type Delete={operation:"delete";did:string}`, example `{"operation":"delete","did":"66aa…"}`, response `Redirect` example `{"url":"/blog/12"}`). Update/delete require author or system edit privilege; create is rate limited.
