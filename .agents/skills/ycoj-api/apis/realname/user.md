# Real-name user endpoint contracts

Auth requires `PRIV_USER_PROFILE`. Super administrators are exempt from verification and may open these pages without submitting.

## `GET|POST /home/realname`

Description: show the real-name submission form, or create/update the caller’s application.

GET `type Query={}`, example `GET /home/realname`. Response `type Response=HTML`. If the caller’s latest status is `pending` or `approved` and they are not a super administrator, the handler redirects to `/home/realname/result`.

POST `type Input={realName:string;school:string}`, example `{"realName":"张三","school":"第一中学"}`. Response `type Redirect={url:string}`, example `{"url":"/home/realname/result"}`. `realName` is a required title (2–64 characters after trim); `school` is a required name (2–128 characters after trim). A pending application is updated in place; a rejected or missing application creates a new pending record. An already-approved user receives `RealnameAlreadyApprovedError`. Rate limit: 10 submissions per 60 seconds per user.

The user document is updated with `realnameStatus:"pending"`, `realName`, `realnameSchool`, and `school`.

## `GET /home/realname/result`

Description: show the caller’s latest verification status. Request `type Query={}`, example `GET /home/realname/result`. Response `type Response=HTML`. If the caller has never submitted and is not a super administrator, the handler redirects to `/home/realname`.

Status values: `none` | `pending` | `approved` | `rejected`.
