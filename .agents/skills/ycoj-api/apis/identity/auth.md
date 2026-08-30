# Authentication, registration, and account routes

**Shared authentication.** Public endpoints need no credentials. Profile routes require `Cookie: sid=<token>` or `Authorization: Bearer <token>` and `PRIV_USER_PROFILE`; the two system routes require `PRIV_EDIT_SYSTEM`. Form fields may be URL-encoded or JSON. A successful redirect is `302 Location: /target` normally, or `200 application/json` `{ "url": "/target" }` with `Accept: application/json`.

## `/login`

### GET — render sign-in

Use this to show local login. `type LoginPageQuery = { redirect?: string }`; example: `GET /login?redirect=%2Fhome%2Fsecurity`. It returns `type LoginPage = HTML` (example `<!doctype html>…login…`) and is public.

### POST — sign in

Use this to create a session. `type LoginInput = { uname: string; password: string; rememberme: boolean; redirect?: string; tfa?: string; authnChallenge?: string; judge?: boolean }`; example `{"uname":"alice","password":"correct horse","rememberme":true,"redirect":"/"}`. Username/password are validated; TFA/WebAuthn is required when configured. Returns `type Redirect = {url:string}` (JSON example `{"url":"/"}`) and sets `sid`; public. If the account's optional `accountExpireAt` has passed, this attempt first atomically bans the account, deletes all account tokens, and returns the existing blacklisted-user error instead of creating a session. The same gate runs for OAuth and WebAuthn successful-authentication paths. Logged-in users who have not submitted real-name information, or whose seven-day grace period has expired without approval, are redirected to `/home/realname` or `/home/realname/result` instead of `redirect` or the homepage. Users still inside the grace period follow the normal redirect. Super administrators and judge service accounts skip real-name verification; super administrators cannot be assigned an account expiration through the management endpoint.

## `/logout`

### GET/POST — end session

Use either browser logout link or AJAX logout. `type LogoutInput = { domainId?: string }`; POST example `{"domainId":"system"}` (GET has no required arguments). It clears the session and returns `Redirect`, example `{"url":"/"}` for JSON. Requires profile privilege.

## `/user/sudo`

### GET — render re-authentication

`type Empty = {}`; example `GET /user/sudo`. Returns `HTML`, example `…sudo.html…`; requires profile privilege.

### POST — establish sudo confirmation

`type SudoInput = { password?: string; tfa?: string; authnChallenge?: string }`; example `{"password":"correct horse","tfa":"123456"}`. It verifies one configured factor and marks the session as sudo. Response `Redirect`, example `{"url":"/home/security"}`; requires profile privilege.

## `/user/tfa` and `/user/webauthn`

### `GET /user/tfa`

Use during the TFA UI flow. `type TfaQuery = { q: string }`; example `GET /user/tfa?q=setup`. Response is `HTML`, example `…tfa…`; state/session determines which actions are possible.

### `GET /user/webauthn`

Use to request WebAuthn creation/assertion options. `type WebAuthnQuery = { uname?: string; login: boolean }`; example `GET /user/webauthn?uname=alice&login=true`. Response `type PublicKeyOptions = Record<string, unknown>`; example `{"challenge":"…","rpId":"example.test","allowCredentials":[]}`.

### `POST /user/webauthn`

Use to verify the browser credential. `type WebAuthnInput = { result: PublicKeyCredentialJSON; redirect?: string }`; example `{"result":{"id":"…","rawId":"…","response":{}},"redirect":"/"}`. Response is `Redirect`, example `{"url":"/"}`; verification failure is an error response.

## Registration and recovery

### `GET|POST /register`

GET displays registration: `type Empty = {}`, example `GET /register`, response `HTML`. POST starts email registration: `type RegisterRequest = { mail: string }`, example `{"mail":"alice@example.test"}`; email validation applies. Response `Redirect`, example `{"url":"/login"}`. Both require `PRIV_REGISTER_USER`.

### `GET|POST /register/:code`

GET validates a registration token and renders completion form: `type CodePath={code:string}`, example `/register/opaque-token`; response `HTML`. POST completes it: `type RegisterComplete={code:string;password:string;verifyPassword:string;uname?:string}`; example `{"code":"opaque-token","uname":"alice","password":"secret","verifyPassword":"secret"}`. Response `Redirect`, example `{"url":"/"}` and a session is created. Requires registration privilege; token and matching password are checked.

### `GET|POST /lostpass`

GET returns `HTML` for the recovery form. POST input `type LostPassRequest={mail:string}`, example `{"mail":"alice@example.test"}`; response `Redirect`, example `{"url":"/login"}` after issuing mail. Public; email validation applies.

### `GET|POST /lostpass/:code`

GET validates `type CodePath={code:string}` and returns `HTML`. POST input `type LostPassComplete={code:string;password:string;verifyPassword:string}`, example `{"code":"opaque-token","password":"new secret","verifyPassword":"new secret"}`. Response `Redirect`, example `{"url":"/login"}`; token/password validation applies; public.

## User and OAuth

### `POST /user/delete`

Use to remove the signed-in account. `type DeleteInput={password:string}`, example `{"password":"correct horse"}`. Response `Redirect`, example `{"url":"/"}`. Requires profile privilege and valid password.

### `GET /user/:uid`

Use to display a profile. `type UserPath={uid:number}`, example `GET /user/12`. Response `HTML` (`user_detail.html`), example `…alice…`; domain visibility is checked.

### `GET /oauth/:type/login`

Use to begin an installed provider login. `type OAuthStart={type:string;redirect?:string}`, example `/oauth/github/login?redirect=%2F`. Returns provider `302` (or logical `Redirect`), e.g. `{"url":"https://github.com/login/oauth/authorize?…"}`. Public. Valid `type` values are runtime registrations, not a fixed API.

### `GET /oauth/:type/callback`

Provider callback only. `type OAuthCallback=Record<string,string>` is provider-defined; example `/oauth/github/callback?code=…&state=…`. It returns a redirect to login/registration continuation; do not synthesize it outside provider flow.

## Conditional contest-mode route

### `GET /contestmode`

When `server.contestmode` is enabled, list IP bindings. `type Empty={}`; response `type ContestModePage=HTML & {bindings:Array<{_id:number;loginip:string}>}`, example body context `{"bindings":[{"_id":12,"loginip":"203.0.113.8"}]}`. Requires `PRIV_EDIT_SYSTEM`.

### `POST /contestmode` operation `reset`

`type ResetInput={operation:"reset";uid?:number}`, example `{"operation":"reset","uid":12}`; omit `uid` to clear all bindings. Returns `Redirect`, example `{"url":"/contestmode"}`. Requires `PRIV_EDIT_SYSTEM`.
