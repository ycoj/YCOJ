# Files, storage, judges, metrics, and connections

- [Detailed file, judge, monitoring, and connection contracts](endpoints.md)
- [Strict WebSocket/SSE connection contracts](connections.md)
- [System-management HTTP contracts](../domain/manage.md)

## HTTP routes

| Route / methods | Request | Response / authorization |
| --- | --- | --- |
| `/file` GET, POST | `GET ?uid?:int` (another user's files requires admin). Upload: multipart `file` plus `filename`; delete: `{files:string[]}`. | GET HTML/PJAX body includes `{files,urlForFile}`; mutations redirect. Personal uploads require `PRIV_CREATE_FILE`; quotas and filename validation apply. |
| `/file/:uid/:filename` GET | `?noDisposition=boolean` | Browser 302 to signed object storage, or HTTP 200 `{url}` with `Accept: application/json`; authenticated users may download only their own listed files, and callers who lack real-name access (not approved, not exempt, and not inside the seven-day grace period) are blocked. Adds public cache header. |
| `/storage` GET | `?target=name&filename?:filename&expire:uint&secret:string` | Binary/streamed object body; content type guessed, optional attachment disposition. Link signature and expiry required. |
| `/judge/files` GET, POST | Judge-authenticated POST `{id?:string,files?:Set<string>,pid?:uint}`. Example `{pid:1000,files:["1.in"]}`. | GET `"ok"`; POST `{url:string}` for submission code or `{links:Record<string,string>}` for testdata. `PRIV_JUDGE`. |
| `/judge/upload` POST | multipart `file`, `{rid:ObjectId,name:filename}`. | `{ok:1}`; `PRIV_JUDGE`, then record/problem ownership and file limits are checked. |
| `/metrics` GET | no body | Prometheus text exposition (`text/plain`); package-enabled route, no handler permission guard. |
| `/center/report` POST | `{installId:string,payload:string}` | Telemetry report handler response (normally empty/success); optional `center` package. |
| `/onlyoffice-jwt` GET | `?url=string` | JSON/token used by OnlyOffice integration; optional package and its configured signing key. |
| `/heap-snapshot` POST | `{worker:int}` | `{worker:string|undefined,filename:string}` or `{error:"Not current worker"}`. Registered only with `--enable-heap-snapshot`; system admin. |

## WebSocket/SSE connections

The server registers connections through the same domain/base/user middleware as HTTP. Use an authenticated session cookie where required. If `server.enableSSE` is enabled, the server also exposes its connection transport as SSE fallback; connection URL/query arguments are unchanged, outbound frames arrive as SSE data, and client-to-server messages must use the server's supported fallback transport. WebSocket is the native/current transport.

| Endpoint | Handshake and inbound frames | Outbound frames / access |
| --- | --- | --- |
| `/websocket` | Handshake does not throw `RealnameRequiredError`. Optional gateway header `x-hydro-websocket-gateway` must equal `websocket.secret`. Normal clients send `{operation:"subscribe"\|"unsubscribe",credential?:sessionToken,channels:string[],request_id?:string,subscription_id?:string,metadata?:object}`. Gateway-only `{operation:"resume",channels}` resumes channels. | Subscribe returns `{operation:"verify",accept:string[],reject:string[],request_id?,subscription_id?}`; profile users who are neither approved nor within the seven-day real-name grace period are rejected unless the connection is a privileged gateway. Resume failure is `{operation:"resume_failed"}`. Subsequent payloads are channel-provider events. Gateway header grants privileged subscription metadata. |
| `/judge/conn` | Judge daemon connects; no application message is required to receive work. | Initial `{language: setting.langs}`, then judge task/result protocol from `JudgeConnectionHandler`. Route requires `PRIV_JUDGE`; single-task concurrency. |
| `/manage/check-conn` | Connect with administrator session; no input frame required. Closing cancels the check. | `{type:"log"|"warn"|"error",payload:any}` streaming diagnostics. `PRIV_EDIT_SYSTEM`. |

`/api/:op/conn` is documented in the [framework API reference](../api/README.md): only `Subscription` operations and its special `rpc` multiplexing mode are accepted. The excluded record connection endpoints are intentionally not covered here.
