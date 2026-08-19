# Domain endpoint contracts

Every authenticated call uses `Cookie: sid=<token>` or `Authorization: Bearer <token>`. HTML is server-rendered; mutations return `type Redirect={url:string}` under `Accept: application/json` (example `{"url":"/domain/dashboard"}`) and 302 otherwise.

## `GET /ranking`
Description: paginated domain rank list. Request `type Query={page?:number}`, example `GET /ranking?page=2`. Response `type Response=HTML`, example `<!doctype html>…ranking…`. Permission: `PERM_VIEW_RANKING`.

## `GET /domain/dashboard`
Description: domain admin overview. Request `type Query={}`, example `GET /domain/dashboard`. Response `HTML`, example `…domain_dashboard…`. Permission: domain management handler.

### POST `initDiscussionNode`
Description: reset the active domain's discussion nodes from `discussion.nodes` system configuration, creating configured missing nodes. Request `type Input={operation:"initDiscussionNode"}`, example `{"operation":"initDiscussionNode"}`. Response `type Redirect={url:string}`, example `{"url":"/domain/dashboard"}`. Permission: domain management. **Source correction:** this operation belongs to `DomainDashboardHandler` and therefore `/domain/dashboard`, not `/domain/edit`.

## `GET|POST /domain/edit`
Description: display/save configured domain properties. GET request `type Query={}`, example `GET /domain/edit`, response `HTML`. POST request `type Input=Record<string,string|number|boolean>` (registered domain-setting fields), example `{"name":"School","bulletin":"Welcome"}`, response `Redirect`, example `{"url":"/domain/dashboard"}`. Permission `PERM_EDIT_DOMAIN`.

## `GET|POST /domain/user`
Description: list and administer domain users. GET request `type Query={format?:"default"|"raw"}`, example `GET /domain/user?format=raw`; response `type Response=HTML|Array<{_id:number;uname:string}>`, example `[{"_id":12,"uname":"alice"}]`. POST request `type Input={operation?:string;uids:number[];role?:string;join?:boolean}`, example `{"operation":"setRole","uids":[12],"role":"member","join":true}`; response `Redirect`, example `{"url":"/domain/user"}`. Permission: domain management.

### POST `setUsers`
Description: assign a role to selected members and optionally mark them joined. Request `type Input={operation:"setUsers";uids:number[];role:string;join?:boolean}`, example `{"operation":"setUsers","uids":[12,13],"role":"member","join":true}`. Response `Redirect`, example `{"url":"/domain/user"}`. The base POST rejects including the domain owner; sudo is required. Inviting when `server.allowInvite` is off additionally needs `PRIV_MANAGE_ALL_DOMAIN`.

### POST `kick`
Description: revoke joined members and return them to `guest`. Request `type Input={operation:"kick";uids:number[]}`, example `{"operation":"kick","uids":[12,13]}`. Response `Redirect`, example `{"url":"/domain/user"}`; if none are joined it returns without a redirect/body. The base POST rejects the owner and sudo is required; affected users receive a message.

## `GET|POST /domain/permission`
Description: view/update permission assignments. GET `type Query={}`, example `GET /domain/permission`, response `HTML`. POST `type Input=Record<string,string|number|boolean>`, example `{"role":"teacher","perm":255}`, response `Redirect`, example `{"url":"/domain/permission"}`. Permission `PERM_EDIT_DOMAIN`.

## `GET|POST /domain/role`
Description: view/update roles. GET `type Query={}`, example `GET /domain/role`, response `HTML`. POST `type Input={operation?:string;role?:string;roles?:string[]}`, example `{"operation":"set","role":"teacher","roles":["teacher"]}`, response `Redirect`, example `{"url":"/domain/role"}`. Permission `PERM_EDIT_DOMAIN`.

## `GET|POST /domain/group`
Description: manage user groups. GET `type Query={}`, example `GET /domain/group`, response `HTML`. POST `type Input={operation?:string;name:string;uids?:number[]}`, example `{"operation":"set","name":"ClassA","uids":[12,13]}`, response `Redirect`, example `{"url":"/domain/group"}`. Permission `PERM_EDIT_DOMAIN`.

## `GET|POST /domain/join_applications`
Description: configure membership application policy. GET `type Query={}`, example `GET /domain/join_applications`, response `HTML`. POST `type Input={method:0|1|2;role?:string;group?:string;expire?:number;invitationCode?:string}`, example `{"method":2,"role":"member","group":"ClassA","expire":1800000000,"invitationCode":"invite"}`, response `Redirect`, example `{"url":"/domain/join_applications"}`. Permission: domain management.

## `GET|POST /domain/join`
Description: show/submit a request to join a domain. GET `type Query={code?:string;target?:string;redirect?:string}`, example `GET /domain/join?target=school&code=invite`, response `HTML|Redirect`, example `…join…`. POST same type, example `{"target":"school","code":"invite","redirect":"/"}`, response `Redirect`, example `{"url":"/"}`. Permission `PRIV_USER_PROFILE`; join policy/code is validated.

## `GET /domain/search`
Description: find accessible domains. Request `type Query={q?:string}`, example `GET /domain/search?q=sch`. Response `type Result=Array<{_id:string;name:string;avatarUrl:string}>`, example `[{"_id":"school","name":"School","avatarUrl":"/img/team_avatar.png"}]`. Permission `PRIV_USER_PROFILE`.
