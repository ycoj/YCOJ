# Management endpoint contracts

Each endpoint requires `PRIV_EDIT_SYSTEM` via `SystemHandler` (except the connection, documented in runtime). Auth: `sid` Cookie or Bearer. `Redirect` means JSON `{url:string}` with `Accept: application/json`, otherwise 302.

## `GET /manage`
Description: management entrypoint. Request `type Query={}`, example `GET /manage`. Response `type Redirect={url:string}`, example `{"url":"/manage/dashboard"}`.

## `GET|POST /manage/dashboard`
Description: dashboard and process restart. GET request `type Query={}`, example `GET /manage/dashboard`; response `type Response=HTML`, example `…manage_dashboard…`. POST `type Restart={operation:"restart"}`, example `{"operation":"restart"}`; response `Redirect`, example `{"url":"/manage/dashboard"}`. Restart fails when not launched by PM2.

## `GET|POST /manage/script`
Description: display/run a registered admin script. GET `type Query={}`, example `GET /manage/script`, response `HTML`. POST `type Input={id:string;args?:string}`, example `{"id":"rebuild","args":"{}"}`, response `type Result=unknown|Redirect`, example `{"url":"/manage/script"}`; `id` is validated name and args defaults `{}`.

## `GET|POST /manage/setting`
Description: display/save registered settings. GET `type Query={}`, example `GET /manage/setting`, response `HTML`. POST `type Input=Record<string,string|boolean|number>`, example `{"server.name":"YCOJ"}`, response `Redirect`, example `{"url":"/manage/setting"}`; values are typed/validated by each setting and empty secret fields preserve existing secret.

## `GET|POST /manage/ai-provider`
Description: display/save the global provider registry and the models selected for AI test-data generation and HTML-to-Markdown conversion. This route requires `PRIV_EDIT_SYSTEM` and sudo.

GET request type: `type Query = {}`. Example:
```http
GET /manage/ai-provider HTTP/1.1
Accept: text/html
Cookie: sid=<sid>
```

GET response type: `type Response = HTML`, with the redacted configuration JSON embedded as the `#ai-provider-value` form field. Stored API keys are never returned. Example response body fragment:
```html
<form method="post" id="ai-provider-form">
  <textarea name="value" id="ai-provider-value" hidden>{
  "version": 1,
  "providers": [{
    "id": "provider-1",
    "name": "OpenAI",
    "apiType": "openai-responses",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "",
    "models": [{
      "id": "model-1",
      "name": "GPT-5",
      "model": "gpt-5",
      "reasoning": true,
      "thinkingLevel": "high",
      "contextTokens": 128000,
      "maxTokens": 32000
    }]
  }],
  "dataGeneration": {"providerId": "provider-1", "modelId": "model-1"},
  "htmlToMarkdown": {"providerId": "provider-1", "modelId": "model-1"}
}</textarea>
</form>
```

POST request type: `type Input = { value: string }`, where `value` is JSON with `version: 1`, a nonempty `providers` array, `dataGeneration: {providerId, modelId}`, and `htmlToMarkdown: {providerId, modelId}`. Older configurations without `htmlToMarkdown` are accepted and use `dataGeneration` for conversion. Example:
```http
POST /manage/ai-provider HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=<sid>

{
  "value": "{\"version\":1,\"providers\":[{\"id\":\"provider-1\",\"name\":\"OpenAI\",\"apiType\":\"openai-responses\",\"baseUrl\":\"https://api.openai.com/v1\",\"apiKey\":\"sk-example\",\"models\":[{\"id\":\"model-1\",\"name\":\"GPT-5\",\"model\":\"gpt-5\",\"reasoning\":true,\"thinkingLevel\":\"high\",\"contextTokens\":128000,\"maxTokens\":32000}]}],\"dataGeneration\":{\"providerId\":\"provider-1\",\"modelId\":\"model-1\"},\"htmlToMarkdown\":{\"providerId\":\"provider-1\",\"modelId\":\"model-1\"}}"
}
```

POST response type: `type Redirect = { url: string }` with `Accept: application/json`; successful save example:
```json
{"url":"/manage/ai-provider"}
```
Without JSON content negotiation, the same successful save responds `302 Location: /manage/ai-provider`. Each provider requires a stable 6-64 character ID, name, `apiType` (`openai-completions` or `openai-responses`), HTTP(S) `baseUrl`, API key, and a nonempty model list. Each model requires ID, name, API model ID, reasoning flag, thinking level, 8192-2000000 context tokens, and 1024-1000000 output tokens no larger than its context limit. An empty key preserves an existing provider key; a new provider requires one. Both selected models must belong to their selected providers, duplicate IDs and invalid values fail validation, and providers/models selected for either operation or used by active generations cannot be removed until another selection is saved.

## `GET|POST /manage/config`
Description: display/save raw system config. GET `type Query={}`, example `GET /manage/config`, response `HTML`. POST `type Input={value:string}`, example `{"value":"server:\n  name: YCOJ\n"}`, response `Redirect`, example `{"url":"/manage/config"}`.

## `GET /manage/config/schema.json`
Description: get JSON Schema for settings. Request `type Query={}`, example `GET /manage/config/schema.json`. Response `type JsonSchema=Record<string,unknown>`, example `{"type":"object","properties":{"server.name":{"type":"string"}}}`.

## `GET|POST /manage/userimport`
Description: render/import users. GET `type Query={}`, example `GET /manage/userimport`, response `HTML`. POST `type Input={users:string;draft:boolean}`, example `{"users":"alice,alice@example.test","draft":true}`, response `Redirect`, example `{"url":"/manage/userimport"}`.

## `GET|POST /manage/userpriv`
Description: inspect/set global privilege bits. GET `type Query={extraIgnore?:number[]}`, example `GET /manage/userpriv?extraIgnore=1`, response `HTML`. POST `type Input={uid:number;priv:number;system:boolean}`, example `{"uid":12,"priv":4,"system":false}`, response `Redirect`, example `{"url":"/manage/userpriv"}`; uid/int and unsigned privilege validation applies.

Manually changing a user's privileges cancels any saved automatic-expiration restoration state. A later expiration extension therefore never reverses an explicit administrator ban.

## `GET|POST /manage/user-expiration`

Default header: `Accept: application/json`; requests and logical redirect responses are JSON. Browser requests without JSON content negotiation render HTML or return HTTP 302. Every method requires `PRIV_EDIT_SYSTEM` and sudo confirmation.

GET lists real accounts (virtual users are excluded) in ascending UID order, 100 per page. Request `type Query={page?:number;q?:string}`, example `GET /manage/user-expiration?page=2&q=alice`. `page` is a positive integer. `q` performs exact numeric UID matching plus case-insensitive username/email prefix matching. Response `type Response={udocs:Array<{_id:number;uname:string;mail:string;avatar?:string;priv:number;accountExpireDate:string;accountExpired:boolean;accountAutoExpired:boolean;accountExpirationProtected:boolean}>;page:number;numPages:number;count:number;q:string}`, example:

```json
{"udocs":[{"_id":12,"uname":"alice","mail":"alice@example.test","accountExpireDate":"2026-09-01","accountExpired":false,"accountAutoExpired":false,"accountExpirationProtected":false}],"page":1,"numPages":1,"count":1,"q":"alice"}
```

POST `set` request `type SetExpiration={operation:"set";uids:number[];expireDate:string}`, example `{"operation":"set","uids":[12,13],"expireDate":"2026-09-01"}`. `expireDate` is strict `YYYY-MM-DD`; the selected day remains usable and expiration begins at the following midnight in the acting administrator's configured timezone. Past dates are accepted and trigger banning only when the target next accesses the service.

POST `adjust` request `type AdjustExpiration={operation:"adjust";uids:number[];days:number}`, example `{"operation":"adjust","uids":[12,13],"days":30}`. `days` is a nonzero integer and is applied as calendar days in the acting administrator's timezone. Every selected account must already have a finite expiration; otherwise the whole request fails with `AccountExpirationRequiredError` (`400`, message `Every selected account must already have a finite expiration.`).

POST `clear` request `type ClearExpiration={operation:"clear";uids:number[]}`, example `{"operation":"clear","uids":[12,13]}`. It removes the expiration. If an account was automatically banned by expiration, its saved pre-expiration privileges are restored; manually banned accounts remain banned.

All POST variants reject an empty/nonpositive UID list, a missing account, or any super-administrator target before changing accounts. A successful operation returns `type Redirect={url:string}`, example `{"url":"/manage/user-expiration"}`. Accounts without `accountExpireAt`, including existing and newly registered accounts, never expire. On the first authenticated request, login, or new connection at/after `accountExpireAt`, the server atomically saves the current privileges, sets `PRIV_NONE`, records an expiration ban reason, invalidates user caches, and deletes every token owned by the account. Login after that point returns `AccountExpiredError` (`403`, message `Your account has expired. Please contact your teacher or coach!`). Existing long-lived connections are not proactively closed.

## `GET|POST /manage/realname`
Description: list and review real-name applications. This route requires super-admin privilege (`PRIV_ALL`), not only `PRIV_EDIT_SYSTEM`.

GET request type: `type Query={page?:number;status?:"all"|"pending"|"approved"|"rejected";uname?:string}`. Example `GET /manage/realname?status=pending&uname=ali`. `uname` is a case-insensitive literal substring filter on usernames; regex metacharacters are treated literally, and no matching username returns an empty list. Each user contributes only their latest application; `status` filters that latest record, so revoke-then-resubmit users appear once under `pending`. Response page data is `{page_name:"manage_realname",rdocs,udict,page,numPages,count,filterStatus,filterUname}`, JSON example `{"page_name":"manage_realname","rdocs":[],"udict":{},"page":1,"numPages":0,"count":0,"filterStatus":"pending","filterUname":"ali"}` with `Accept: application/json`, otherwise HTML. Default status filter is `pending`.

POST `approve`: `type Approve={operation:"approve";id:string}`, example `{"operation":"approve","id":"66aa66aa66aa66aa66aa66aa"}`. Response `Redirect`. Only pending applications may be approved; the user’s `realnameStatus` becomes `approved` and they keep site access after the grace period.

POST `reject`: `type Reject={operation:"reject";id:string;reason?:string}`, example `{"operation":"reject","id":"66aa66aa66aa66aa66aa66aa","reason":"Name mismatch"}`. Response `Redirect`. The seven-day grace clock from the first `realnameSubmittedAt` is kept; the user remains able to use the site until it expires and may resubmit without starting a new window.

POST `revoke`: `type Revoke={operation:"revoke";id:string;reason?:string}`, example `{"operation":"revoke","id":"66aa66aa66aa66aa66aa66aa"}`. Response `Redirect`. Only approved applications may be revoked; status becomes `rejected`, `realnameSubmittedAt` is kept, and the user is locked immediately if the original seven-day window has elapsed. Certified CCF/NOI awards on that account are unbound; if unbind fails for a reason other than `AwardNotBoundError`, the real-name status change is rolled back.

## `GET|POST /manage/award`
Description: list and remove certified CCF/NOI awards. This route requires `PRIV_EDIT_SYSTEM`. See [Award management](../award/manage.md).

GET request type: `type Query={page?:number;uname?:string}`. Example `GET /manage/award?uname=ali`. Response is HTML or `{page_name:"manage_award",odocs,udict,page,numPages,count,filterUname}`.

POST `unbind`: `type Unbind={operation:"unbind";uid:number}`, example `{"operation":"unbind","uid":12}`. Response `Redirect`. Clears the user’s bound contestant and CCF hook.
