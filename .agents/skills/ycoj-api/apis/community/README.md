# Home, discussions, and blogs

- [Strict home/account endpoint contracts](home.md)
- [Strict discussion and blog endpoint contracts](discussion-blog.md)
- [Pastebin endpoint contracts](pastebin.md)

## Home/account routes

| Route | Request example | Response / permission |
| --- | --- | --- |
| `/` GET | no arguments | Homepage HTML assembled from the configured widgets; widget data respects each `PERM_VIEW_*`. |
| `/home/security` GET/POST | POST operations update password, TFA, WebAuthn, connected identities, etc., using UI fields. | Security page/redirect; `PRIV_USER_PROFILE`, and sensitive mutations require sudo where decorated. |
| `/home/settings/:category` GET/POST | `/home/settings/profile`; `POST {category:"profile", ...settings}`. | Category HTML/redirect; profile privilege. |
| `/home/avatar` POST | `{input:"data:image/png;base64,…"}` | `{url:string}` after avatar validation/storage; profile privilege. |
| `/home/changeMail/:code` GET | token path parameter | Consumes/validates email-change token then redirects; profile privilege. |
| `/home/domain` GET | `?all=true` | HTML containing accessible domains; profile privilege. |
| `/home/domain/create` GET/POST | `{id:"school",name:"School",bulletin:"…",avatar:"…"}` | Form/redirect; `PRIV_CREATE_DOMAIN`. |
| `/home/messages` GET/POST | UI operations include message content and `messageId:ObjectId`; e.g. `{operation:"delete",messageId:"66…"}`. | HTML/redirect; profile privilege. |

## Discussion routes

`ObjectId` examples use a 24-hex Mongo id. Routes render discussion templates except raw routes.

| Route / methods | Description, typed input | Response / access |
| --- | --- | --- |
| `/discuss` GET | `?page?:positive-int&all?:boolean` list discussions. | HTML/PJAX. `PERM_VIEW_DISCUSSION`. |
| `/discuss/:type/:name` GET | Node listing, e.g. `/discuss/problem/1000?page=1`; `type` is a supported vnode kind. | HTML; node visibility enforced. |
| `/discuss/:type/:name/create` GET, POST | Create: `{type:string,title:string,content:string,highlight:boolean,pin:boolean}`. | Form/redirect; profile + `PERM_CREATE_DISCUSSION`. |
| `/discuss/:did` GET, POST | Read thread; `?page=1`. POST dispatches reply/moderation operations (lock, react, reply/edit/delete/star) with validated `did`, `drid`, `drrid`, `content`, `emoji`, etc. | HTML/redirect; each operation additionally checks ownership/moderation permission. |
| `/discuss/:did/edit` GET, POST | Edit title/content/moderation flags: `{did:ObjectId,title:string,content:string,highlight:boolean,pin:boolean}`. | Form/redirect; owner or moderator. |
| `/discuss/:did/raw`, `/discuss/:did/:drid/raw`, `/discuss/:did/:drid/:drrid/raw` GET | `?time?:uint&all?:boolean`; return source text for the selected post/reply. | `text/plain` body, example `"Original **Markdown**"`; visibility/ownership checks. |

## Blog routes (optional `blog` package)

| Route / methods | Request | Response / access |
| --- | --- | --- |
| `/blog/:uid` GET | `?page=positive-int` | User blog list HTML. |
| `/blog/:uid/:did` GET, POST | POST operations on the blog discussion (reply/moderation) use `did:ObjectId` and the shared discussion fields. | Detail HTML/redirect; blog visibility and ownership checks. |
| `/blog/:uid/create` GET, POST | `{title:string,content:string}` | Edit form/redirect; profile privilege. |
| `/blog/:uid/:did/edit` GET, POST | `{did:ObjectId,title:string,content:string}` | Edit form/redirect; author/moderator. |

Authenticated community requests accept the ordinary `sid` session cookie or `Authorization: Bearer <sid>` through the shared base layer.
