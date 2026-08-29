# Pastebin

All pastebin routes are global (they do not use the current domain) and require an authenticated account with `PRIV_USER_PROFILE`. Shared links are therefore addressable as `/paste/{id}` from any domain context. Expired documents are rejected immediately on read, regardless of MongoDB TTL cleanup timing.

## `GET /paste`

Description: return the create form and the authenticated user’s own non-expired pastes. Request `type Query={page?:number}`, example `GET /paste?page=1`. Response `type Response=HTML`, example `…paste_main…`; `page` is a positive integer when supplied.

## `POST /paste`

Description: create a paste from form fields. Request `type Input={title?:string;mode:"code"|"markdown";language?:string;content:string;expire?:"day"|"week"|"month"|"never"}`, example:

```json
{"title":"optional","mode":"code","language":"typescript","content":"const x = 1;\n","expire":"month"}
```

`mode` is `code` or `markdown`; `language` is optional and accepted when it is a non-empty Prism-compatible identifier (unsupported identifiers render as plain text). `content` must be non-empty and at most 64 KiB; it is retained exactly, including whitespace. `title` is optional and limited to 64 characters. `expire` is `day`, `week`, `month`, or `never`; finite values are calculated relative to creation time. The operation is rate-limited to 60 creations per hour per user. On success the response is `type Redirect={url:string}`, example `{"url":"/paste/{id}"}`.

## `GET /paste/{id}`

Description: return a paste detail page. Request `type Path={id:string}`, example `GET /paste/abc123`. Response `type Response=HTML`, example `…paste_detail…`. Markdown is rendered through the sanitized Markdown renderer. Code is escaped in `<pre><code class="language-{language}">` markup when a language is provided. The page includes copy-link and raw-content links, and an edit link for the owner or a system administrator.

## `GET /paste/{id}/raw`

Description: return the exact stored content. Request `type Path={id:string}`, example `GET /paste/abc123/raw`. Response `type Source=string`, example `"const x = 1;\n"`, with `Content-Type: text/plain`. Expired or missing IDs return not found.

## `GET /paste/{id}/edit`

Description: return the edit form. Request `type Path={id:string}`, example `GET /paste/abc123/edit`. Response `type Response=HTML`, example `…paste_edit…`; only the owner or a system administrator may access it, and other authenticated users are denied.

## `POST /paste/{id}/edit`

Description: use standard form operation dispatch. Request `type Update={operation:"update";id:string;title?:string;mode:"code"|"markdown";language?:string;content:string;expire?:"day"|"week"|"month"|"never"}` or `type Delete={operation:"delete";id:string}`, example `{"operation":"update","id":"abc123","mode":"code","content":"const x = 1;","expire":"month"}`. With update, the content/title/mode/language are saved and finite expiration is recalculated relative to save time (or cleared for `never`). With delete, owners and system administrators may delete. Response `type Redirect={url:string}`, example `{"url":"/paste/abc123"}` for update or `{"url":"/paste"}` for delete.
