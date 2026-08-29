# UI and utility endpoint contracts

Authenticated calls use `Cookie: sid=<token>` or `Authorization: Bearer <token>`. `HTML` is a rendered page. Redirects are HTTP 302, or `type Redirect={url:string}` (example `{"url":"/"}`) with `Accept: application/json`.

## `GET /ui/nav`
Description: retrieve navigation available in the active domain. Request `type Query={}`, example `GET /ui/nav`. Response `type Nav={navItems:unknown[];user:Record<string,unknown>}`, example `{"navItems":[{"name":"home","url":"/"}],"user":{"_id":12,"uname":"alice"}}`; filtered by current user/domain visibility.

## `GET /ui/languages`
Description: list configured languages, optionally constrained by problem. Request `type Query={pid?:number}`, example `GET /ui/languages?pid=1000`. Response `type Languages={languages:Record<string,{display:string;versions:Array<{display:string;name:string;pretest?:string|false;hidden?:boolean;validAs?:string}>}>}`, example `{"languages":{"cc":{"display":"C/C++","versions":[{"display":"C++17","name":"cc.cc17","hidden":false,"validAs":"judgeclient.0"}]}}}`; problem id is validated when supplied. `pretest` and `hidden` mirror the language config; `validAs` is the language key on the problem's remote judge provider (resolved from `config.subType`) and is only present for `remote_judge` problems that map the language.

## `POST /ui/media`
Description: resolve rich-media JSON models used by the UI. Request `type Input={uids?:number[];pids?:number[];cids?:string[];hids?:string[]}`, example `{"uids":[12],"pids":[1000],"cids":["66aa66aa66aa66aa66aa66aa"]}`. Response `type Media={udict:Record<string,unknown>;pdict:Record<string,unknown>;cdict:Record<string,unknown>;hdict:Record<string,unknown>}`, example `{"udict":{"12":{"_id":12,"uname":"alice"}},"pdict":{"1000":{"docId":1000}},"cdict":{},"hdict":{}}`; inaccessible objects are filtered by handler/model checks.

## `POST /media`
Description: render rich user/problem/contest/homework references to HTML snippets. Request `type Input={domainId?:string;items:Array<{type:"user"|"problem"|"contest"|"homework";id:string;domainId?:string}>}`, example `{"items":[{"type":"user","id":"12"}]}`. Response `type Result=string[]`, example `["<a class=\"user\" href=\"/user/12\">alice</a>"]`; unknown/inaccessible item is `""`.

## `POST /markdown`
Description: render Markdown. Request `type Input={text:string;inline?:boolean}`, example `{"text":"**hi**","inline":false}`. Response `type Html=string`, example `"<p><strong>hi</strong></p>"` with `Content-Type: text/html`.

## `GET /wiki/help` and `GET /wiki/about`
Description: render help/about content. Request `type Query={}`, examples `GET /wiki/help`, `GET /wiki/about`. Responses `HTML`; about additionally carries `type About={sections:Array<{id:string;title:string;content:string}>}`, example `{"sections":[{"id":"intro","title":"Intro","content":"…"}]}`. Public.

## `GET /set_theme/:theme`
Description: persist the selected theme. Request `type Path={theme:string}`, example `GET /set_theme/dark`. Response `Redirect`, example `{"url":"/"}`. Requires profile privilege.

## `GET /legacy`
Description: set legacy/nohint session flags. Request `type Query={legacy?:boolean;nohint?:boolean}`, example `GET /legacy?legacy=true&nohint=false`. Response `Redirect`, example `{"url":"/"}`; public/session scoped.

## `GET /language/:lang`
Description: select display language. Request `type Path={lang:string}`, example `GET /language/zh`. Response `Redirect`, example `{"url":"/"}`; validates name and persists it for signed-in profile users.

## `GET /account/:uid`
Description: system-admin impersonation/account switch. Request `type Path={uid:number}`, example `GET /account/12`. Response `Redirect`, example `{"url":"/"}`. Requires sudo and `PRIV_EDIT_SYSTEM`.

## `GET /lazy/:version/:name`, `/resource/:version/:name`, `/plugins/:version/:name`
Description: serve versioned UI-default lazy/resource assets and UI-next plugin assets. Request `type AssetPath={version:string;name:string}`, examples `/lazy/abc/main.js`, `/resource/abc/logo.svg`, `/plugins/abc/chunk.js`. Response `type Asset=Binary`, example JavaScript bytes `export default {};`; content type/cache headers come from asset handler. Public; `name` is filename-validated and absent versions/files are not found.
