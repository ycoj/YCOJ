# Judge status API

## `GET /status`

Public status page; returns rendered HTML (`status.html`, with the normal page wrapper), not a JSON API. The body model is `{ stats: Status[]; languages: Record<string,string>; compilers: Array<{key:string[];message:string}> }`. Each status is decorated with `isOnline` (last update within five minutes) and `status: "Online"|"Offline"`; battery is normalized to a string such as `"No battery"` or `"ACME X 80% Charging"`. Example JSON model: `{ "stats": [{ "_id":"judge-1", "type":"judge", "isOnline":true, "status":"Online" }], "languages": { "C++(cpp)":"g++" }, "compilers": [{ "key":["cpp"], "message":"g++ 13" }] }`.

## `POST /status/update`

Judge agents only (`PRIV_JUDGE`). Authenticate with `Cookie: sid=...` or `Authorization: Bearer <sid>`. Body fields are passed through and forced to `{ type: "judge", updateAt: Date }`; `mid` identifies the machine. Typical request: `{ "mid":"judge-1", "compilers": {"cpp":"g++ 13"}, "battery": {"hasBattery":false} }`. Response is JSON `{ ok: 1 }`. Missing/invalid privilege or validation fails; records expire from the status collection after roughly one day.
