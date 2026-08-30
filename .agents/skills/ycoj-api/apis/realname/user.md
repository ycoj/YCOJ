# Real-name user endpoint contracts

Auth requires `PRIV_USER_PROFILE`. Super administrators and judge service accounts are exempt from verification and may open these pages without submitting.

## `GET|POST /home/realname`

Description: show the real-name submission form, or create/update the caller’s application.

GET `type Query={}`, example `GET /home/realname`. Response `type Response=HTML`. If the caller’s latest status is `approved` and they are not a super administrator, the handler redirects to `/home/realname/result`; pending users remain on the edit form so they can update their application. The page includes whether the caller is still inside the seven-day grace period and the grace deadline. If `realnameSubmittedAt` is missing, GET copies the earliest application `submittedAt` onto the user document before computing grace.

POST `type Input={realName:string;school:string}`, example `{"realName":"张三","school":"第一中学"}`. Response `type Redirect={url:string}`, example `{"url":"/home/realname/result"}`. `realName` is a required title (2–64 characters after trim); `school` is a required name (2–128 characters after trim). The first submission records `realnameSubmittedAt` and starts the seven-day grace period. A pending application is updated in place. A rejected application creates a new pending record. In all of these cases the original `realnameSubmittedAt` is kept (the seven-day grace clock is not reset). An already-approved user receives `RealnameAlreadyApprovedError`. Rate limit: 10 submissions per 60 seconds per user.

The user document is updated with `realnameStatus:"pending"`, `realName`, `realnameSchool`, and `realnameSubmittedAt` (first submission only).

## `GET /home/realname/result`

Description: show the caller’s latest verification status and remaining grace, if any. Request `type Query={}`, example `GET /home/realname/result`. Response `type Response=HTML`. If the caller has never submitted and is not a super administrator, the handler redirects to `/home/realname`. If `realnameSubmittedAt` is missing, GET copies the earliest application `submittedAt` onto the user document before computing grace.

Status values: `none` | `pending` | `approved` | `rejected`. Pending or rejected callers still inside the grace window can use ordinary site features until `realnameSubmittedAt + 7 days` (falling back to the earliest application `submittedAt` when the user field is missing). Resubmitting after that deadline does not restore access.
