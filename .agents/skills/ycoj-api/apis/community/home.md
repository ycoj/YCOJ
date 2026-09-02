# Home/account endpoint contracts

Auth is `Cookie: sid=<token>` or `Authorization: Bearer <token>`. HTML denotes server-rendered body. Redirects are 302, or `type Redirect={url:string}`/`{"url":"/…"}` for JSON-accepting callers.

## `GET /`
Description: configured dashboard homepage. Request `type Query={}`, example `GET /`. Response `type Response=HTML`, example `…homepage…`; widgets omit data without their `PERM_VIEW_*` permission.

## `GET|POST /home/security`
Description: account security view and UI-selected security mutation. GET `type Query={}`, example `GET /home/security`, response `HTML`. POST `type Input=Record<string,unknown>` (operation-specific password/TFA/WebAuthn/provider fields), example `{"operation":"changePassword","oldPassword":"old","password":"new"}`, response `Redirect`, example `{"url":"/home/security"}`. Requires profile privilege; sensitive operations require sudo where handler decorates them.

### Security POST operations

`linkAccount`: starts a registered OAuth provider bind. `type Link={operation:"linkAccount";platform:string}`, example `{"operation":"linkAccount","platform":"github"}`. Response `type Redirect={url:string}`, example `{"url":"https://github.com/login/oauth/authorize?…"}`; unknown provider is validation error.

`unlinkAccount`: `type Unlink={operation:"unlinkAccount";platform:string}`, example `{"operation":"unlinkAccount","platform":"github"}`. Response `Redirect`, example `{"url":"/home/security"}`; provider must exist.

`deleteToken`: revoke one session by its MD5 token digest. `type DeleteToken={operation:"deleteToken";tokenDigest:string}`, example `{"operation":"deleteToken","tokenDigest":"d41d8cd98f00b204e9800998ecf8427e"}`. Response `Redirect`, example `{"url":"/home/security"}`; nonmatching digest is `InvalidTokenError`.

`deleteAllTokens`: revoke all sessions. `type DeleteAll={operation:"deleteAllTokens"}`, example `{"operation":"deleteAllTokens"}`. Response `Redirect`, example `{"url":"/login"}`.

`enableTfa`: sudo-only TOTP activation. `type EnableTfa={operation:"enableTfa";code:string;secret:string}`, example `{"operation":"enableTfa","code":"123456","secret":"BASE32SECRET"}`. Response `Redirect`, example `{"url":"/home/security"}`; rejects already-enabled or invalid code.

`enableAuthn`: sudo-only finish WebAuthn registration after the `register` operation has stored the challenge. `type EnableAuthn={operation:"enableAuthn";name:string;result:PublicKeyCredentialJSON}`, example `{"operation":"enableAuthn","name":"Laptop key","result":{"id":"…","response":{}}}`. Response `Redirect`, example `{"url":"/home/security"}`; verification failure is validation error.

`disableAuthn`: sudo-only remove an authenticator. `type DisableAuthn={operation:"disableAuthn";id:string}`, example `{"operation":"disableAuthn","id":"base64CredentialId"}`. Response `Redirect`, example `{"url":"/home/security"}`; unknown id is validation error.

`disableTfa`: sudo-only TOTP removal. `type DisableTfa={operation:"disableTfa"}`, example `{"operation":"disableTfa"}`. Response `Redirect`, example `{"url":"/home/security"}`; rejects when TFA is already disabled.

## `GET|POST /home/settings/:category`
Description: show/save a user settings category. GET `type Path={category:string}`, example `GET /home/settings/profile`, response `HTML`. POST `type Input={category:string}&Record<string,unknown>`, example `{"category":"profile","bio":"Hello"}`, response `Redirect`, example `{"url":"/home/settings/profile"}`. Content and short-text values are validated for their size limits and normalized with trimming before persistence; YAML/JSON subtypes are still parsed and rejected when invalid. Requires profile privilege.

## `POST /home/avatar`
Description: validate/save avatar data. Request `type Input={input:string}`, example `{"input":"data:image/png;base64,iVBOR…"}`. Response `type Result={url:string}`, example `{"url":"/avatar/12"}`. Requires profile privilege.

## `GET /home/changeMail/:code`
Description: consume an email-change token. Request `type Path={code:string}`, example `GET /home/changeMail/opaque-token`. Response `Redirect`, example `{"url":"/home/security"}`. Requires profile privilege and valid token.

## `GET /home/domain`
Description: list caller domains. Request `type Query={all?:boolean}`, example `GET /home/domain?all=true`. Response `HTML`, example `…home_domain…`. Requires profile privilege.

### POST `leave`
Description: leave a non-system domain. Request `type Leave={operation:"leave";id:string}`, example `{"operation":"leave","id":"school"}`. Response `Redirect`, example `{"url":"/home/domain"}`. System domain, unknown domains, and invalid ids are rejected.

## `GET|POST /home/domain/create`
Description: show/create a domain. GET `type Query={}`, response `HTML`. POST `type Input={id:string;name:string;bulletin:string;avatar:string}`, example `{"id":"school","name":"School","bulletin":"Welcome","avatar":""}`, response `Redirect`, example `{"url":"/home/domain"}`. Requires `PRIV_CREATE_DOMAIN`.

## `GET|POST /home/realname`
Description: submit or update the caller’s real-name application. GET `type Query={}`, example `GET /home/realname`, response `HTML` or redirect to `/home/realname/result` when status is `approved`. POST `type Input={realName:string;school:string}`, example `{"realName":"张三","school":"第一中学"}`, response `Redirect`, example `{"url":"/home/realname/result"}`. Requires profile privilege. Unverified users may call this route. The first submission starts a seven-day grace period (`realnameSubmittedAt`); pending in-place updates, rejections, revokes, and resubmits do not reset it. After the grace period, unfinished or rejected review returns `RealnameRequiredError` on other feature routes; public versioned UI assets (`/lazy/*`, `/resource/*`, `/plugins/*`) do not. Super administrators and judge service accounts are exempt.

## `GET /home/realname/result`
Description: show the caller’s latest verification status and remaining grace, if any. Request `type Query={}`, example `GET /home/realname/result`. Response `HTML`, or redirect to `/home/realname` when no application exists. Requires profile privilege.

## `GET|POST /home/award`
Description: bind imported CCF/NOI awards to the caller after real-name approval. GET `type Query={others?:boolean;page?:number}`, example `GET /home/award?others=1`. Response `HTML`. POST `type Input={oierId:number}`, example `{"oierId":12}`, response `Redirect`, example `{"url":"/home/award"}`. Requires profile privilege and an approved real name. See [Award certification](../award/user.md).

## `GET|POST /home/messages`
Description: view/manage private messages. GET `type Query={}`, response `HTML`. POST `type Input={operation?:string;messageId?:string;content?:string}`, example `{"operation":"delete","messageId":"66aa66aa66aa66aa66aa66aa"}`, response `Redirect`, example `{"url":"/home/messages"}`. Requires profile privilege.

### POST `deleteMessage`
Description: delete a sent message. Request `type DeleteMessage={operation:"deleteMessage";messageId:string}`, example `{"operation":"deleteMessage","messageId":"66aa66aa66aa66aa66aa66aa"}`. Response `Redirect`, example `{"url":"/home/messages"}`. Only the message sender may delete it.
