# Bulk edit problems

This workflow uses [problem-set.md](../apis/problem/problem-set.md) and [problem-create-edit.md](../apis/problem/problem-create-edit.md). It requires `Cookie: sid=…`, `Accept: application/json`, and per-problem owner-self-edit permission or `PERM_EDIT_PROBLEM`.

1. Discover selected problems and record both the numeric `docId` and display `pid`. The bulk route accepts numeric document IDs, while per-problem edits use the display PID:

   ```http
   GET /p?q=category:legacy&limit=50&page=1&quick=true
   Accept: application/json
   Cookie: sid=…
   ```

   From `pdocs`, save `docId` values (for example `[1000,1001]`). Stop if the search has additional pages (`ppcount > 1`) until all intended IDs are collected.

2. To translate selected statements into another language, process one problem at a time. Fetch the full current edit/detail data, then translate only `title` and `content`. Preserve `pid`, `hidden`, `tag`, and `difficulty` exactly; preserve all code blocks, math syntax, and `file://` references in content unchanged.

   ```http
   GET /p/P1000/edit
   Accept: application/json
   Cookie: sid=…
   ```

   ```http
   POST /p/P1000/edit
   Accept: application/json
   Cookie: sid=…
   Content-Type: application/json

   {"title":"A Plus B","content":"## Problem Description\nCalculate A+B.\n\n![asset](file://diagram.png)","pid":"P1000","hidden":false,"tag":"math,beginner","difficulty":1}
   ```

   Read back `GET /p/P1000` and compare the translated title/content plus the preserved PID, hidden flag, tags, difficulty, and file references. Stop on the first mismatch, duplicate PID, or authorization error; do not continue to the next problem until it is corrected.

3. Optional bulk state operations use the numeric `docId` values. For example, hide a selected set:

   ```http
   POST /p
   Accept: application/json
   Cookie: sid=…
   Content-Type: application/json

   {"operation":"hide","pids":[1000,1001]}
   ```

   The result is a framework back response. Verify each individual `GET /p/{pid}` as an authorized editor, or re-list using a permission that can view hidden problems. Stop on the first permission/not-found error; earlier IDs may already have changed, so inspect before retrying.

4. If a temporary hidden state is desired, bulk-unhide only the verified numeric IDs after all per-item checks:

   ```http
   POST /p
   Accept: application/json
   Cookie: sid=…
   Content-Type: application/json

   {"operation":"unhide","pids":[1000,1001]}
   ```

   Do not use `operation=delete` as an edit rollback: deletion permanently removes eligible problems and is blocked if a problem is used by a contest only on the single-problem route, not by the bulk handler.
