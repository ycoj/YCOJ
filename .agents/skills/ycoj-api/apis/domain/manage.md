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
Description: display/save the global provider registry and the model selected for AI test-data generation. This route requires `PRIV_EDIT_SYSTEM` and sudo.

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
  "dataGeneration": {"providerId": "provider-1", "modelId": "model-1"}
}</textarea>
</form>
```

POST request type: `type Input = { value: string }`, where `value` is JSON with `version: 1`, a nonempty `providers` array, and `dataGeneration: {providerId, modelId}`. Example:
```http
POST /manage/ai-provider HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=<sid>

{
  "value": "{\"version\":1,\"providers\":[{\"id\":\"provider-1\",\"name\":\"OpenAI\",\"apiType\":\"openai-responses\",\"baseUrl\":\"https://api.openai.com/v1\",\"apiKey\":\"sk-example\",\"models\":[{\"id\":\"model-1\",\"name\":\"GPT-5\",\"model\":\"gpt-5\",\"reasoning\":true,\"thinkingLevel\":\"high\",\"contextTokens\":128000,\"maxTokens\":32000}]}],\"dataGeneration\":{\"providerId\":\"provider-1\",\"modelId\":\"model-1\"}}"
}
```

POST response type: `type Redirect = { url: string }` with `Accept: application/json`; successful save example:
```json
{"url":"/manage/ai-provider"}
```
Without JSON content negotiation, the same successful save responds `302 Location: /manage/ai-provider`. Each provider requires a stable 6-64 character ID, name, `apiType` (`openai-completions` or `openai-responses`), HTTP(S) `baseUrl`, API key, and a nonempty model list. Each model requires ID, name, API model ID, reasoning flag, thinking level, 8192-2000000 context tokens, and 1024-1000000 output tokens no larger than its context limit. An empty key preserves an existing provider key; a new provider requires one. The selected model must belong to the selected provider, duplicate IDs and invalid values fail validation, and providers/models used by active generations cannot be removed.

## `GET|POST /manage/config`
Description: display/save raw system config. GET `type Query={}`, example `GET /manage/config`, response `HTML`. POST `type Input={value:string}`, example `{"value":"server:\n  name: YCOJ\n"}`, response `Redirect`, example `{"url":"/manage/config"}`.

## `GET /manage/config/schema.json`
Description: get JSON Schema for settings. Request `type Query={}`, example `GET /manage/config/schema.json`. Response `type JsonSchema=Record<string,unknown>`, example `{"type":"object","properties":{"server.name":{"type":"string"}}}`.

## `GET|POST /manage/userimport`
Description: render/import users. GET `type Query={}`, example `GET /manage/userimport`, response `HTML`. POST `type Input={users:string;draft:boolean}`, example `{"users":"alice,alice@example.test","draft":true}`, response `Redirect`, example `{"url":"/manage/userimport"}`.

## `GET|POST /manage/userpriv`
Description: inspect/set global privilege bits. GET `type Query={extraIgnore?:number[]}`, example `GET /manage/userpriv?extraIgnore=1`, response `HTML`. POST `type Input={uid:number;priv:number;system:boolean}`, example `{"uid":12,"priv":4,"system":false}`, response `Redirect`, example `{"url":"/manage/userpriv"}`; uid/int and unsigned privilege validation applies.
