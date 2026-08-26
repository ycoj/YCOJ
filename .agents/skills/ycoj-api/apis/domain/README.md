# Domain, ranking, and management routes

- [Strict domain endpoint contracts](domain.md)
- [Strict management endpoint contracts](manage.md)

These are HTML/PJAX management pages, not REST resources. `GET` renders the named page; `POST` fields select a handler operation (`operation` convention) and generally redirects on success. All state-changing fields are decorator-validated in the handler.

| Route / methods | Description / request | Response / authorization |
| --- | --- | --- |
| `/ranking` GET | Domain ranking; `?page=positive-int` (example `?page=2`). | Rendered ranking page. `PERM_VIEW_RANKING`. |
| `/domain/dashboard` GET | Domain moderation dashboard. | HTML. Handler requires domain-management permission. |
| `/domain/edit` GET, POST | Read/edit domain properties. POST accepts the domain setting fields selected by the UI. | HTML or redirect. `PERM_EDIT_DOMAIN`. |
| `/domain/user` GET, POST | List members (`?format=default\|raw`) and mutate selected users. E.g. `{operation:"setRole",uids:[12],role:"member",join:true}`. | HTML, or raw user export for `format=raw`; management permission. |
| `/domain/permission` GET, POST | Inspect/edit domain permission bitmasks. | HTML/redirect; `PERM_EDIT_DOMAIN`. |
| `/domain/role` GET, POST | Inspect/edit named roles. E.g. `{role:"teacher",roles:["teacher","student"]}`. | HTML/redirect; `PERM_EDIT_DOMAIN`. |
| `/domain/group` GET, POST | List/create/update/delete member groups. E.g. `{name:"ClassA",uids:[12,13]}`. | HTML/redirect; `PERM_EDIT_DOMAIN`. |
| `/domain/join_applications` GET, POST | Configure join policy. `POST {method:0|1|2,role?:string,group?:string,expire?:int,invitationCode?:string}`. | HTML/redirect; domain-management permission. |
| `/domain/join` GET, POST | Show/apply a join request. `?code?&target?:domainId&redirect?`. | Render/redirect; signed-in profile privilege; target domain validates policy/code. |
| `/domain/search` GET | Autocomplete visible domains. `?q=string`. | JSON `Domain[]`, e.g. `[{_id:"system",name:"Hydro",avatarUrl:"/…"}]`; profile privilege. |
| `/manage` GET | Entry route. | 302 `/manage/dashboard`; system administrator. |
| `/manage/dashboard` GET, `POST restart` | Server dashboard/restart. | HTML; restart redirects and only works under PM2. `PRIV_EDIT_SYSTEM`. |
| `/manage/script` GET, POST | Run an allowlisted management script. `{id:name,args?:string}` (args is JSON text, defaults `{}`). | GET HTML; POST body from script then redirect. System administrator. |
| `/manage/setting` GET, POST | View/update system settings. POST is dynamic keys from the registered settings schema. | HTML/redirect; secret values are not overwritten by empty input. System administrator. |
| `/manage/ai-provider` GET, POST | View/save the global AI provider registry, nested models, and the models selected for AI data generation and HTML-to-Markdown conversion. POST `{value:string}` is a JSON configuration document. | HTML/redirect; sudo-protected system administrator. Provider API keys are never returned; an empty key preserves an existing provider key, while a new provider requires one. |
| `/manage/config` GET, POST | View/save raw server config. `POST {value:string}` (configuration text). | HTML/redirect; system administrator. |
| `/manage/config/schema.json` GET | Machine-readable JSON Schema of settings. | JSON Schema; `PRIV_EDIT_SYSTEM`. |
| `/manage/userimport` GET, POST | Parse/import user data. `POST {users:string,draft:boolean}`. | HTML/redirect; system administrator. |
| `/manage/userpriv` GET, POST | View/set system user privilege bits. `GET ?extraIgnore[]=int`; `POST {uid:int,priv:uint,system:boolean}`. | HTML/redirect; system administrator (sudo restrictions apply). |

For all pages above, authenticate with `Cookie: sid=<token>` or `Authorization: Bearer <token>`. `PRIV_EDIT_SYSTEM` means global system administration; `PERM_EDIT_DOMAIN` is checked against the active domain.
