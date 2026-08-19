# Create a problem from local files

This workflow uses [problem-create-edit.md](../apis/problem/problem-create-edit.md) and [problem-files.md](../apis/problem/problem-files.md). It assumes `Cookie: sid=…` with `PERM_CREATE_PROBLEM` and uses `Accept: application/json` for every POST.

1. Create a hidden draft and capture `pid` from the returned body (follow the redirect only as a convenience):

   ```http
   POST /problem/create
   Accept: application/json
   Cookie: sid=…
   Content-Type: application/json

   {"title":"A + B","content":"## Description\nCompute A+B.","pid":"P1000","hidden":true,"difficulty":1,"tag":"math"}
   ```

   Stop if creation returns a duplicate-PID validation error. The response is `{"pid":"P1000","url":"/p/P1000/files"}`; use that exact path ID below.

2. Upload every local test file with one multipart request per file. Field `file` contains file bytes; `filename` is the target name and `type=testdata` selects test data:

   ```http
   POST /p/P1000/files
   Accept: application/json
   Cookie: sid=…
   Content-Type: multipart/form-data

   operation=upload_file&type=testdata&filename=1.in&file=@./testdata/1.in
   ```

   For a test-data ZIP, upload it with `type=testdata`; it expands non-directory entries. Do not use ZIP expansion for additional files. A back response means the operation completed; stop on file-limit/size or ZIP validation errors.

3. Upload `config.yaml` in the same way (`filename=config.yaml`, `type=testdata`) and upload statement assets with `type=additional_file`. Verify inventory with:

   ```http
   GET /p/P1000/files?d=testdata,additional_file&sidebar=false
   Accept: application/json
   Cookie: sid=…
   ```

   Confirm every expected name is present in `testdata` or `additional_file`; otherwise stop and correct the failed upload.

4. While the problem is still hidden, fetch `GET /p/P1000/submit` and choose a key from its `langRange` (for example the current built-in `cc.cc17`). Submit the standard solution and save `rid` from its `{rid,url}` response:

   ```http
   POST /p/P1000/submit
   Accept: application/json
   Cookie: sid=…
   Content-Type: application/json

   {"lang":"cc.cc17","code":"#include <bits/stdc++.h>\nusing namespace std;\nint main(){long long a,b;if(cin>>a>>b) cout<<a+b<<'\\n';}","pretest":false,"input":[]}
   ```

   A successful normal submission is represented as `{ "rid":"66b5c0e00000000000000000", "url":"/record/66b5c0e00000000000000000" }`. A file-based standard solution may instead use `multipart/form-data` with `file=@./solution.cpp`, `lang=cc.cc17`, and `pretest=false` (omit `code`).

5. Poll the returned record until it reaches a terminal status:

   ```http
   GET /record/66b5c0e00000000000000000
   Accept: application/json
   Cookie: sid=…
   ```

   Continue only when `rdoc.status` is `1` (`STATUS_ACCEPTED`). Statuses `0`, `20`, `21`, and `22` are non-terminal (waiting, judging, compiling, and fetched); poll those with a bounded interval. If the record reaches any other status, keep the problem hidden and stop with its result/detail diagnostics. Do not unhide while the record remains non-terminal.

6. Make the problem visible using the edit route, retaining title/content/PID and metadata but setting `hidden:false`:

   ```http
   POST /p/P1000/edit
   Accept: application/json
   Cookie: sid=…
   Content-Type: application/json

   {"title":"A + B","content":"## Description\nCompute A+B.","pid":"P1000","hidden":false,"tag":"math","difficulty":1}
   ```

   Verify `{ "url":"/p/P1000" }`, then `GET /p/P1000` with `Accept: application/json` and `Cookie: sid=…`. Stop if the detail response does not contain the expected PID/title or visibility check fails.
