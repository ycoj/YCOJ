# Award user endpoint contracts

Auth requires `PRIV_USER_PROFILE`. Binding requires `realnameStatus === 'approved'` and a stored `realName`. Super administrators and judge service accounts are treated as verified only when they also have a real name; otherwise GET explains that certification is unavailable.

Default header: `Accept: application/json`

## `GET|POST /home/award`

Description: show contestant matches for the caller’s verified name and school, or bind one contestant to the account.

GET `type Query={others?:boolean;page?:number}`, example `GET /home/award?others=1&page=1`. Response `type Response=HTML`. If the caller is not real-name approved (or has no `realName`), the page reports that award certification is unavailable. If the account already has `oierId`, the page lists that contestant’s records and does not offer another bind. Otherwise it lists contestants whose `name` equals `realName`. By default only contestants whose `latestSchool` matches `realnameSchool` (canonical name, alias, or contained official name of at least 4 characters) are shown. `others=1` includes same-name contestants at other schools. When the preferred list is empty, `showingOthers` is true even without the query flag. Page size is `pagination.award` (default 20).

POST `type Input={oierId:number}`, example `{"oierId":12}`. Response `type Redirect={url:string}`, example `{"url":"/home/award"}`. The server re-checks the real name, that the caller has no `oierId`, and that the contestant is not bound to another account. Success sets `user.oierId`, `user.oierBoundAt`, and `user.ccfLevel`. Errors: `AwardRealnameRequiredError` (403), `AwardAlreadyBoundError` (403), `AwardOierTakenError` (403), `AwardNameMismatchError` (403), `AwardOierNotFoundError` (404). Rate limit: 5 binds per 60 seconds per user.

## `GET /user/:uid` (awards tab)

Description: the profile page includes certified award rows when the viewed user has `oierId`, or an empty-state call-to-action when the viewer is that user. Request `type UserPath={uid:number}`, example `GET /user/12`. Response `HTML` with `awardRecords` sorted by year descending. Each row includes `contestName`, `award`, `score`, `rank`, `school`, `province`, and `grade`. Usernames rendered on this page (and elsewhere through `user.render_inline`) include a CCF hook image when `ccfLevel` is 3–5 (green), 6–8 (blue), or 9–10 (gold).
