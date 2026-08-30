# Award management endpoint contracts

`GET|POST /manage/award` requires `PRIV_EDIT_SYSTEM`. Auth: `sid` Cookie or Bearer. `Redirect` means JSON `{url:string}` with `Accept: application/json`, otherwise 302.

Default header: `Accept: application/json`

## `GET /manage/award`

Description: list accounts that currently have certified awards. Request `type Query={page?:number;uname?:string}`, example `GET /manage/award?page=1&uname=ali`. `uname` is a case-insensitive literal substring filter on usernames; regex metacharacters are treated literally. Response `type Response={page_name:"manage_award";odocs:OierDoc[];udict:Record<number,UserDoc>;page:number;numPages:number;count:number;filterUname:string}`, or HTML. Page size is `pagination.award` (default 20).

`OierDoc` fields: `_id` (contestant id), `name`, `ccfLevel`, `ccfScore`, `schools`, `latestSchool`, `recordCount`, `uid`.

## POST `unbind`

Description: remove a user’s award certification. Request `type Unbind={operation:"unbind";uid:number}`, example `{"operation":"unbind","uid":12}`. Response `Redirect`, example `{"url":"/manage/award"}`. Clears `user.oierId`, `user.oierBoundAt`, and sets `user.ccfLevel` to 0; also unsets `oier.uid`. If clearing the user fields fails after `oier.uid` was removed, that `uid` is put back on the contestant. Unknown or unbound users return `AwardNotBoundError` (400). The profile Awards tab posts the same operation to this URL when the viewer has `PRIV_EDIT_SYSTEM`.
