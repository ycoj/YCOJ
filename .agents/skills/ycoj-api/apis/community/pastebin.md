# Pastebin

All pastebin routes are global (they do not use the current domain) and require an authenticated account with `PRIV_USER_PROFILE`. Shared links are therefore addressable as `/paste/{id}` from any domain context. Expired documents are rejected immediately on read, regardless of MongoDB TTL cleanup timing.

## `GET /paste`

Description: return the create form and the authenticated user’s own never-expiring or not-yet-expired pastes (`expireAt` missing or in the future). Request `type Query={page?:number}`, example `GET /paste?page=1`. Response `type Response=HTML`, example `…paste_main…`; `page` is a positive integer when supplied. Page size is the `pagination.paste` setting (default 20). The form’s language select offers `cpp`, `python`, and `javascript` (labels C++, Python, JS) and defaults to `cpp`; that control is hidden when the type is markdown.

## `POST /paste`

Description: create a paste from form fields. This is the only create endpoint; document routes do not inherit it. Request `type Input={title?:string;mode:"code"|"markdown";language?:string;content:string;expire?:"day"|"week"|"month"|"never"}`, example:

```json
{"title":"optional","mode":"code","language":"cpp","content":"int main() {}\n","expire":"month"}
```

`mode` is `code` or `markdown`. The create form sends `language` as `cpp`, `python`, or `javascript` for code pastes (default `cpp`) and omits it for markdown; the server still accepts any optional Prism-compatible identifier matching `^[a-z0-9-]{0,64}$` (unsupported identifiers render as plain text). Markdown pastes store an empty language. `content` must be non-empty and at most 64 KiB; it is retained exactly, including whitespace. `title` is optional and limited to 64 characters. `expire` is persisted as `day`, `week`, `month`, or `never`. Finite values also store a derived `expireAt` relative to creation time for the TTL index; `never` omits `expireAt`. The operation is rate-limited to 60 creations per hour per user. On success the response is `type Redirect={url:string}`, example `{"url":"/paste/{id}"}`.

## `GET /paste/{id}`

Description: return a paste detail page. Request `type Path={id:string}`, example `GET /paste/abc123`. Response `type Response=HTML`, example `…paste_detail…`. Markdown is rendered through the sanitized Markdown renderer. Code is escaped in `<pre><code class="language-{language}">` markup when a language is provided. Known form languages are shown as C++, Python, or JS. The page includes copy-link and raw-content links, and an edit link for the owner or a system administrator. This route is GET-only; POST is Method Not Allowed and does not create a paste.

## `GET /paste/{id}/raw`

Description: return the exact stored content. Request `type Path={id:string}`, example `GET /paste/abc123/raw`. Response `type Source=string`, example `"int main() {}\n"`, with `Content-Type: text/plain`. Expired or missing IDs return not found. This route is GET-only; POST is Method Not Allowed and does not create a paste.

## `GET /paste/{id}/edit`

Description: return the edit form with the stored `expire` choice selected and the language select defaulting to the stored language (or `cpp` when empty). Request `type Path={id:string}`, example `GET /paste/abc123/edit`. Response `type Response=HTML`, example `…paste_edit…`; only the owner or a system administrator may access it, and other authenticated users are denied. A stored language outside `cpp`/`python`/`javascript` is kept as an extra select option. The language control is hidden when the type is markdown.

## `POST /paste/{id}/edit`

Description: use standard form operation dispatch on the existing document only (create remains `POST /paste`). Request `type Update={operation:"update";id:string;title?:string;mode:"code"|"markdown";language?:string;content:string;expire?:"day"|"week"|"month"|"never"}` or `type Delete={operation:"delete";id:string}`, example `{"operation":"update","id":"abc123","mode":"code","language":"cpp","content":"int main() {}","expire":"month"}`. With update, the content/title/mode/language/`expire` are saved; markdown clears `language`; finite `expireAt` is recalculated relative to save time, and `never` unsets `expireAt`. With delete, owners and system administrators may delete. Response `type Redirect={url:string}`, example `{"url":"/paste/abc123"}` for update or `{"url":"/paste"}` for delete.
