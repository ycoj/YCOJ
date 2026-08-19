# Registered non-problem operations

All inputs are supplied as the `args` object to `/api/:op`. `domainId` is injected from the request/domain context and is required in the schemas that say so. Results below are model documents, therefore fields beyond the shown example may be present.

## `query.batch` and `mutation.batch`

Use the framework batch operations to let integrations submit a list of calls (the framework defines their schemas). `type BatchInput=Array<{op:string;args:unknown}>`; example `[{"op":"user","args":{"id":12}},{"op":"domain.current","args":{}}]`. Registered response type is `Record<string,unknown>`; example `{}`. In this codebase the base implementation is a placeholder returning `{}`; do not assume individual calls are executed unless an add-on overrides it. `query.batch` is GET/POST; `mutation.batch` is POST only.

## `user`

Description: find one user by id, login name, email, or default to caller. `type UserArgs={id?:number;uname?:string;mail?:string;domainId:string}`; example `{"id":12,"domainId":"system"}`. Response `type UserDoc=Record<string,unknown>|null`; example `{"_id":12,"uname":"alice","mail":"alice@example.test"}`. It uses normal model lookup; a caller's session/domain controls what data is exposed.

## `users`

Description: autocomplete/resolve multiple users. `type UsersArgs={ids?:number[];auto?:string[];search?:string;limit?:number;exact?:boolean;domainId?:string}`; `domainId` is injected from the active request domain rather than required by the operation schema. Example `{"auto":["12","alice"]}`. Response `type UserDocWithAvatar=UserDoc & {avatarUrl:string}; type UsersResult=UserDocWithAvatar[]`; example `[{"_id":12,"uname":"alice","avatarUrl":"/avatar/…"}]`. `auto` resolves numeric ids then names/emails; more than 50 unresolved names is curtailed. Prefix results are capped at 10.

## `domain`

Description: fetch active domain or a named domain where caller has view rights. `type DomainArgs={id?:string}`; example `{"id":"school"}`. Response `type DomainDoc=Record<string,unknown>|null`; example `{"_id":"school","name":"School"}`. Returns `null`, not a permission error, when the domain/user cannot be viewed.

## `domain.current`

Description: retrieve active-domain context. `type CurrentDomainArgs={}`; example `{}`. Response `type CurrentDomainResult={domain:DomainDoc}`; example `{"domain":{"_id":"system","name":"Hydro"}}`.

## `groups`

Description: list domain user groups, optionally filtering membership/name. `type GroupsArgs={domainId:string;uid?:number;names?:string[];search?:string;limit?:number}`; example `{"domainId":"school","search":"Class","limit":20}`. Response `type Group={name:string;uids?:number[]}; type GroupsResult=Group[]`; example `[{"name":"ClassA","uids":[12,13]}]`. Requires `PERM_VIEW` in the active domain or `PRIV_VIEW_ALL_DOMAIN`; limit is at most 100.

## `domain.group` (mutation)

Description: upsert group membership when `uids` is nonempty, or delete the group when omitted/empty. `type DomainGroupInput={name:string;uids?:number[]}`; example `{"name":"ClassA","uids":[12,13]}`. Response `type DomainGroupResult=boolean`; example `true`. Requires `PERM_EDIT_DOMAIN`; POST only.
