# Onsite toolkit contest endpoints

Authenticate with `Cookie: sid=...` or `Authorization: Bearer <sid>`; routes are domain-relative.

## POST `/contest/:tid/autosubmit`

Description: submit an onsite contestant's uploaded source file to the problem mapped by its filename (`A.*` is first contest problem, `B.*` second, etc.). Request: `type B={dryrun:boolean;file:Blob}`; multipart example `POST /contest/665f.../autosubmit?dryrun=false` with `file=@A.cpp`. The contest must be live, `allowPrint` must be true, filename must be a letter plus extension, language/config/size must pass server validation. Response: `type R={rid?:ObjectId;info?:string;error?:string}`; success `{ "rid":"665f00000000000000000002" }`, dry-run `{ "info":"Contest Weekly\\nProblem A+B\\nLanguage C++ (cpp)" }`, failure `{ "error":"Unsupported file name" }`. The handler returns HTTP 200 JSON even for caught submission errors.

## GET `/contest/:tid/resolver-cdp/:token`

Description: download the completed onsite contest resolver CDP archive with a short-lived export token. Request: `type P={tid:ObjectId;token:string}`; `GET /contest/665f.../resolver-cdp/opaque-token`. Token must belong to this domain/contest and the contest must be ended. Response: `type R=BinaryZip`; `200 application/zip` with `Content-Disposition: attachment; filename="contest-665f...-cdp.zip"` and `Access-Control-Allow-Origin: *`; invalid token or unfinished contest is rejected.
