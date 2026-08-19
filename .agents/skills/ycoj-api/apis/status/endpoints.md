# Status endpoints

## `GET /status`
Description: render current judge/compiler health.
Request: `type Query = {}`. Example: `GET /status`.
Response: `type Response = {stats:StatusDoc[];languages:Record<string,string>;compilers:Array<{key:string[];message:string}>}`. Example: `{ "stats":[],"languages":{"C++(cpp)":"g++"},"compilers":[] }`, rendered `status.html`.

## `POST /status/update`
Description: upsert one judge heartbeat.
Request: `type Request = {mid:string; compilers?:Record<string,string>; battery?:object; [key:string]:unknown}`. Example: `POST /status/update` body `{ "mid":"judge-1","compilers":{"cpp":"g++ 13"} }`.
Response: `type Response = {ok:1}`. Example: `{ "ok":1 }`. Requires `PRIV_JUDGE`; handler forces `type:"judge"` and sets `updateAt`.
