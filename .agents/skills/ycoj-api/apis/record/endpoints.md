# Record endpoints

## `GET /record`
Description: filter/paginate submissions. Request: `type Query={page?:number;pid?:number|string;tid?:ObjectId;uidOrName?:number|string;lang?:string;status?:number;fullStatus?:boolean;all?:boolean;allDomain?:boolean;stat?:boolean}`; `GET /record?page=1&pid=A&uidOrName=alice`. Response: `type Response={page:number;rdocs:RecordDoc[];tdoc:Tdoc|null;pdict:Record<number,ProblemDoc>;udict:Record<number,UserDoc>;all:boolean;allDomain:boolean;filterPid?:number|string;filterTid?:ObjectId;filterUidOrName?:number|string;filterLang?:string;filterStatus?:number;notification:unknown[];statistics?:unknown}`; `{ "page":1,"rdocs":[],"tdoc":null,"pdict":{},"udict":{},"all":false,"allDomain":false,"filterPid":"A","notification":[] }`, HTML `record_main.html`. `rpcount` is not assigned by this handler.

## `GET /record/:rid`
Description: show one submission and revisions. Request: `type Query={rid:ObjectId;download?:boolean;rev?:ObjectId}`; `GET /record/665f00000000000000000002`. Response: `type Response={rdoc:RecordDoc;pdoc:ProblemDoc;udoc:UserDoc;tdoc?:Tdoc;revisions?:RecordDoc[]}`; `{ "rdoc":{"_id":"665f...","status":1},"pdoc":{"docId":1001} }`, HTML `record_detail.html`; status `1` is Accepted.

## `POST /record/:rid` operation `rejudge`
Description: enqueue rejudge for a submission. Request: `type Request={operation:"rejudge"}`; `{ "operation":"rejudge" }`. Response: `type Response={url?:string}`; `{ "url":"/record/665f..." }` or back response.

## `POST /record/:rid` operation `cancel`
Description: cancel a queued/running submission. Request: `type Request={operation:"cancel"}`; `{ "operation":"cancel" }`. Response: `type Response={url?:string}`; `{ "url":"/record/665f..." }` or back response.

## WebSocket `/record-conn`
Description: stream record changes filtered by query. Request: `type Query={tid?:ObjectId;pid?:number|string;uidOrName?:number|string;status?:number;pretest?:boolean;all?:boolean;allDomain?:boolean;noTemplate?:boolean}`; `GET /record-conn?tid=665f...` via WebSocket. Client frame: `type Frame={rids:string[]}`; `{ "rids":["665f..."] }`. Response event: `type Event={html:string}|{udoc:unknown;pdoc:unknown;rdoc:RecordDoc}|{rdoc:Omit<RecordDoc,"code"|"input">}`; `{ "html":"<tr>...</tr>" }` or `{ "udoc":{},"pdoc":{},"rdoc":{} }`. Hidden/other-user filters require record/contest permissions.

## WebSocket `/record-detail-conn`
Description: stream one record’s status. Request: `type Query={rid:ObjectId;noTemplate?:boolean}`; `GET /record-detail-conn?rid=665f...`. Response event: `type Event={status:number;status_html:string;summary_html:string}|{rdoc:RecordDoc}`; `{ "status":1,"status_html":"<div>Accepted</div>","summary_html":"<section>...</section>" }`, or `{ "rdoc":{} }` with `noTemplate=true`. Code is redacted unless the handler’s code permissions pass; completed records close with code 4001 after 30s.
