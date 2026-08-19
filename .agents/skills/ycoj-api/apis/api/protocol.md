# `/api/:op` transport protocol

`/api/:op` is the only generic JSON operation endpoint. It is installed by `applyApiHandler()` in `packages/hydrooj/src/service/server.ts`. Authentication is the ordinary `Cookie: sid=<session-token>` or `Authorization: Bearer <session-token>`; the active domain comes from middleware, but callers may pass `domainId` (the handler merges it into operation arguments).

## `GET /api/:op` — Query

Use for an operation registered as `Query`; mutations are rejected on GET. `type ApiGet = { args?: string | object; projection?: string | string[]; domainId?: string }`. Example:

```http
GET /api/user?args={"id":12}&projection=_id,uname HTTP/1.1
Accept: application/json
```

`args` may be JSON text; `projection` is JSON projection text or comma-separated keys. The response is the operation result directly, not an envelope: `type ApiResult = unknown`; example `{"_id":12,"uname":"alice"}`. Invalid operation, invalid JSON, schema failures, a missing op, or wrong operation type produce Hydro bad-request/error responses.

## `POST /api/:op` — Mutation or Query

Use for `Mutation` (and optionally `Query`). `type ApiPost = { args?: object|string; projection?: object|string|string[]; domainId?:string }`; example:

```json
{"args":{"name":"ClassA","uids":[12,13]}}
```

Response is the raw result, e.g. `true`. If an operation returns `BinaryResponse`, HTTP is file/binary download; if it returns `RedirectResponse`, it is HTTP 302 or logical JSON redirect under `Accept: application/json`. Async-generator progress is emitted through the server's payload mechanism; the final HTTP result is its return value.

## `WS /api/:op/conn` and SSE fallback

This endpoint is implemented and current. Native WebSocket URL carries the same `op`, query `args`, `projection`, and `domainId` format as HTTP. With server SSE enabled, the same endpoint has the server connection/SSE fallback: outbound payloads are SSE data; use the supported fallback client transport for inbound frames. It is not an HTTP subscription response.

For an operation name other than `rpc`, only an API `Subscription` is allowed. There are **no production Subscription operations registered by the current source inventory** (test subscriptions are only installed by `applyTestApis`). If an add-on registers one, its URL has the form `/api/{registered-subscription-op}/conn?args={…}`. Subscription result messages are arbitrary operation payloads (`type SubscriptionEvent=unknown`); connection cleanup invokes the subscription disposer.

`/api/rpc/conn` multiplexes subscription requests when an add-on has registered one. Send `type RpcFrame={op:string;args?:object|string;projection?:object|string|string[]}`; example `{"op":"{registered-subscription-op}","args":{}}`. Only subscription operations are accepted, and the server sends their payloads as frames. It is not usable for a production subscription until one is registered; there is no response envelope or acknowledged request id in `ApiConnectionHandler`.
