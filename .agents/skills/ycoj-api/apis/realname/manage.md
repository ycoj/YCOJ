# Real-name management endpoint contracts

`GET|POST /manage/realname` requires super-admin privilege (`PRIV_ALL`, `priv === -1`). Regular `PRIV_EDIT_SYSTEM` administrators cannot review applications. Auth: `sid` Cookie or Bearer. `Redirect` means JSON `{url:string}` with `Accept: application/json`, otherwise 302.

## `GET /manage/realname`

Description: list applications for review. Request `type Query={page?:number;status?:"all"|"pending"|"approved"|"rejected";uname?:string}`, example `GET /manage/realname?page=1&status=pending&uname=ali`. `uname` is a case-insensitive literal substring filter on usernames, so this example matches names such as `Alice` and `malice`; regex metacharacters in the input are treated literally, and no matching username returns an empty list. Response `type Response={page_name:"manage_realname";rdocs:RealnameApplication[];udict:Record<number,UserDoc>;page:number;numPages:number;count:number;filterStatus:"all"|"pending"|"approved"|"rejected";filterUname:string}`, JSON example `{"page_name":"manage_realname","rdocs":[],"udict":{},"page":1,"numPages":0,"count":0,"filterStatus":"pending","filterUname":"ali"}` with `Accept: application/json`, otherwise HTML. Default `status` is `pending`; page size is `pagination.realname` (default 50).

## POST `approve`

Description: approve a pending application and keep the user unlocked after the grace period. Request `type Approve={operation:"approve";id:string}`, example `{"operation":"approve","id":"66aa66aa66aa66aa66aa66aa"}`. Response `Redirect`, example `{"url":"/manage/realname?status=pending"}`. Invalid transitions, including non-pending applications, return `RealnameInvalidTransitionError`; unknown ids return `RealnameApplicationNotFoundError`.

## POST `reject`

Description: reject a pending application. Request `type Reject={operation:"reject";id:string;reason?:string}`, example `{"operation":"reject","id":"66aa66aa66aa66aa66aa66aa","reason":"Name does not match"}`. Response `Redirect`. Invalid transitions, including non-pending applications, return `RealnameInvalidTransitionError`; unknown ids return `RealnameApplicationNotFoundError`. `realnameSubmittedAt` is kept; the user may still use the site until that timestamp plus seven days, and may resubmit (a resubmit does not start a new grace period). After the grace period expires without approval, the user is locked.

## POST `revoke`

Description: revoke an approved application. Request `type Revoke={operation:"revoke";id:string;reason?:string}`, example `{"operation":"revoke","id":"66aa66aa66aa66aa66aa66aa","reason":"Information is false"}`. Response `Redirect`. Only `approved` applications may be revoked; the resulting status is `rejected` and `realnameSubmittedAt` is kept. If the original seven-day window from the first submission has already elapsed, the user is locked immediately. A later resubmit does not start a new grace period.
