# Training endpoints

## `GET /training`
Description: list trainings, optionally title-searching and paginating. Request: `type Query={page?:number;q?:string}`; `GET /training?page=1&q=dp`. Response: `type Response={tdocs:TrainingDoc[];page:number;tpcount:number;tsdict:Record<string,unknown>;tdict:Record<string,TrainingDoc>;q:string}`; `{ "tdocs":[],"page":1,"tpcount":0,"tsdict":{},"tdict":{},"q":"dp" }` HTML `training_main.html`; view permission required.

## `GET /training/:tid`
Description: render one DAG and computed progress. Request: `type Query={tid:ObjectId;uid?:number}`; `GET /training/665f...?uid=42`. Response: `type Response={tdoc:TrainingDoc;tsdoc:unknown;pids:number[];pdict:Record<number,ProblemDoc>;psdict:Record<number,unknown>;ndict:Record<number,unknown>;nsdict:Record<number,unknown>;udoc:unknown;udict:Record<number,unknown>;selfPsdict:Record<number,unknown>;groups:unknown[];missing:number[]}`; `{ "tdoc":{"docId":"665f..."},"pids":[1001],"missing":[] }` HTML/PJAX.

## `POST /training/:tid` operation `enroll`
Description: enroll current user. Request: `type Request={operation:"enroll"}`; `{ "operation":"enroll" }`. Response: `type Response={url?:string}`; JSON `{ "url":"/training/665f..." }` or browser back. Requires profile privilege.

## `POST /training/:tid` operation `delete`
Description: delete training and its stored files. Request: `type Request={operation:"delete"}`; `{ "operation":"delete" }`. Response: `type Response={url:string}`; `{ "url":"/training" }` or browser redirect. Requires owner/edit permission.

## `GET /training/create` / `GET /training/:tid/edit`
Description: render create/edit form. Request: `type Query={tid?:ObjectId}`; `GET /training/create`. Response: `type Response={page_name:"training_create"|"training_edit";tdoc?:TrainingDoc;dag?:string}`; `{ "page_name":"training_create" }`, HTML `training_edit.html`.

## `POST /training/create` / `POST /training/:tid/edit`
Description: validate DAG and create/update training. Request: `type Request={tid?:ObjectId;title:string;content:string;dag:string;pin:number;description:string}`; `{ "title":"DP","content":"...","dag":"[{\"_id\":1,\"title\":\"A\",\"requireNids\":[],\"pids\":[1001]}]","pin":0,"description":"..." }`. Response: `type Response={tid:ObjectId;url?:string}`; `{ "tid":"665f...","url":"/training/665f..." }`.

## `GET /training/:tid/file`
Description: list editable training files. Request: `type Query={tid:ObjectId}`; `GET /training/665f.../file`. Response: `type Response={tdoc:TrainingDoc;tsdoc:unknown;udoc:unknown;files:unknown[];urlForFile:string}`; `{ "tdoc":{"docId":"665f..."},"files":[] }`, HTML/PJAX.

## `POST /training/:tid/file` operation `uploadFile`
Description: upload one file. Request: `type Request={operation:"uploadFile";filename:string;file:Blob}`; multipart example `filename=readme.md&file=@readme.md`. Response: `type Response={url?:string}`; `{ "url":"/training/665f.../file" }` or back.

## `POST /training/:tid/file` operation `deleteFiles`
Description: delete selected files. Request: `type Request={operation:"deleteFiles";files:string[]}`; `{ "operation":"deleteFiles","files":["readme.md"] }`. Response: `type Response={url?:string}`; `{ "url":"/training/665f.../file" }` or back.

## `GET /training/:tid/file/:filename`
Description: signed download. Request: `type Query={tid:ObjectId;filename:string;noDisposition?:boolean}`; `GET /training/665f.../file/readme.md`. Response: `type Response=Redirect|JsonRedirect`; browser `302 Location: https://storage/signed?...`; with `Accept: application/json`, HTTP 200 `{ "url":"https://storage/signed?..." }`; cache-control public.
