# UI assets, rendering, and miscellaneous routes

- [Strict UI and utility endpoint contracts](endpoints.md)

## UI and document presentation

| Route / methods | Request format/example | Response / access |
| --- | --- | --- |
| `/ui/nav` GET | active domain inferred from host | JSON navigation configuration, e.g. `{main:[…],user:[…]}`; visibility-filtered. |
| `/ui/languages` GET | `?pid?:problemId` | JSON language map/array available in domain (and problem-specific restrictions), e.g. `{"cpp":"C++17"}`. |
| `/ui/media` POST | `{uids?:int[],pids?:int[],cids?:ObjectId[],hids?:ObjectId[]}` | JSON rich-media records used by the UI; only visible entities are returned. |
| `/media` POST | `{domainId?:string,items:Array<{type:"user"|"problem"|"contest"|"homework",id:string,domainId?:string}>}` | JSON `string[]` of rendered HTML snippets, e.g. `["<a …>alice</a>"]`; inaccessible/unknown items become `""`. |
| `/markdown` POST | `{text:string,inline?:boolean}` | `text/html`, e.g. `"<p><strong>hi</strong></p>"`; safe server-side Markdown rendering. |
| `/wiki/help` GET | none | `wiki_help.html`; public. |
| `/wiki/about` GET | none | `about.html` with `{sections:[{id,title,content}]}`; public. |
| `/set_theme/:theme` GET | `/set_theme/dark` | Persists theme then redirects; profile privilege. |
| `/legacy` GET | `?legacy:boolean&nohint:boolean` | Sets session flags and redirects; public/session scoped. |
| `/language/:lang` GET | `/language/zh` | Updates session and, when signed in, user `viewLang`; redirects. `lang` is a name. |
| `/account/:uid` GET | `/account/12` | Switches impersonated session, redirects. Requires sudo and `PRIV_EDIT_SYSTEM`. |

## Static/versioned plugin resources

| Route | Request | Response |
| --- | --- | --- |
| `/lazy/:version/:name`, `/resource/:version/:name` | Version and validated filename, e.g. `/lazy/abc123/main.js`. | UI-default constant/resource bytes with handler-selected content type and cache policy; public, including unverified users (no `RealnameRequiredError`). |
| `/plugins/:version/:name` | Version and validated filename, e.g. `/plugins/abc123/chunk.js`. | UI-next plugin constant/resource bytes; public, including unverified users (no `RealnameRequiredError`). |

These asset paths are build/runtime dependent: a version/name that is not present returns the server's normal not-found response, and are not an upload API.
