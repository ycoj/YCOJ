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

## `GET|POST /manage/config`
Description: display/save raw system config. GET `type Query={}`, example `GET /manage/config`, response `HTML`. POST `type Input={value:string}`, example `{"value":"server:\n  name: YCOJ\n"}`, response `Redirect`, example `{"url":"/manage/config"}`.

## `GET /manage/config/schema.json`
Description: get JSON Schema for settings. Request `type Query={}`, example `GET /manage/config/schema.json`. Response `type JsonSchema=Record<string,unknown>`, example `{"type":"object","properties":{"server.name":{"type":"string"}}}`.

## `GET|POST /manage/userimport`
Description: render/import users. GET `type Query={}`, example `GET /manage/userimport`, response `HTML`. POST `type Input={users:string;draft:boolean}`, example `{"users":"alice,alice@example.test","draft":true}`, response `Redirect`, example `{"url":"/manage/userimport"}`.

## `GET|POST /manage/userpriv`
Description: inspect/set global privilege bits. GET `type Query={extraIgnore?:number[]}`, example `GET /manage/userpriv?extraIgnore=1`, response `HTML`. POST `type Input={uid:number;priv:number;system:boolean}`, example `{"uid":12,"priv":4,"system":false}`, response `Redirect`, example `{"url":"/manage/userpriv"}`; uid/int and unsigned privilege validation applies.
