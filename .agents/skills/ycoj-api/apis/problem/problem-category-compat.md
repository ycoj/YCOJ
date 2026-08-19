# GET `/p/category/:category` — legacy category URL redirect

## Description

Compatibility route for an older category-specific problem-set URL. It does not query or validate the category itself; it redirects to the normal problem-set route with `q=category:{category}`. The route registration has no explicit permission argument; the destination `/p` enforces `PERM_VIEW_PROBLEM`.

## Request format

```ts
type CategoryPath = { category: string };
```

The path parameter is passed unchanged into the search query. A browser request needs no special body or content type.

```http
GET /p/category/dp HTTP/1.1
Accept: application/json
Cookie: sid=…
```

## Response format

```ts
type CategoryRedirectJson = { url: string };
type CategoryRedirectBrowser = never; // HTTP redirect
```

With `Accept: application/json`, the framework serializes the handler redirect:

```json
{"url":"/p?q=category%3Adp"}
```

Without JSON accept, the same handler response is an HTTP redirect to the normal problem-set URL (the exact query encoding is router/framework output).
