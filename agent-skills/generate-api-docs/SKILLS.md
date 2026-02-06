---
name: generate-api-docs
description: Generate API documentation from code base.
---

# Goal and Scope

You will generate API documentation for the current repository (hydrooj). The documentation must be grounded in the actual implementation and should not invent behavior. An API doc example is available at `references/example.md`.

# Repository Basics (hydrooj)

## Routing and Handlers

- HTTP routes are registered via `ctx.Route`, and paths follow koa-router and path-to-regexp syntax, e.g. `/p/:pid` where `:pid` is a route parameter.
- Route registrations are concentrated in each module’s `apply(ctx)`, for example `packages/hydrooj/src/handler/*.ts`.
- The API entry is registered at service startup: `/api/:op`, which maps to GraphQL-style Query/Mutation/Subscription operations; a WebSocket/SSE connection is available at `/api/:op/conn`.

## Request Parameter Parsing

- Handler method parameters are declared using decorators: `@param/@get/@post/@route`, sourced from merged args, query, body, and route params respectively.
- Types and validation are defined via `Types.*` in `framework/framework/validator.ts`.
- Optional params are marked with the third argument `true`; if missing, they are not required.
- If a method signature starts with `domainId`, the current domain ID (string) is injected automatically.

## Permissions and Visibility

- Route-level permissions are declared in `ctx.Route(name, path, Handler, PERM.*, PRIV.*)`.
- Handlers may also call `checkPerm`/`checkPriv` for finer-grained checks.
- When generating docs, include both route-level permissions and in-handler permission checks in the “Permission” column.

# API Documentation Requirements

The generated API documentation must follow this structure and align with the example format in `references/example.md`.

## Title

`Resource Name + HTTP Method + Path`, for example: `Record Main \`GET /record\``.

## Params (Request Parameters)

Use a table that includes:

- Parameter: name
- Type: type with constraints (e.g. `number (PositiveInt)`, `string (ObjectId)`, `boolean`)
- Purpose: what the parameter is used for
- Permission: required permission constant names if any; otherwise use `None`

Parameter sources are derived from decorators:

- `@route` → path params
- `@get/@query` → query
- `@post` → body
- `@param` → any (merged by framework)

## Result (Response Body)

Describe the response field by field:

- Field name
- Type (if it is a shared type such as `ProblemDoc`, `RecordDoc`, `Homework`, use the type name directly; otherwise expand the object structure)
- Meaning

If a field is optional or a collection, annotate clearly, e.g. `RecordDoc[]`, `field?: string`, `type | null`.

# Default Header Convention

All API docs must state the default header:

`Accept: application/json`

This means both request and response bodies are JSON.
