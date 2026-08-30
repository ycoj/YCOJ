# Award import script

This is not an HTTP route. Super administrators with `PRIV_EDIT_SYSTEM` run it from `POST /manage/script` (`id` `importOier`) or `hydrooj cli script importOier '<json>'`.

## `importOier`

Description: parse an OIerDb `data/` directory and replace the `oier`, `oier.record`, `oier.school`, and `oier.contest` collections. The parser skips duplicate contest names (warning only). Replacement writes the new documents to `*.importing` collections and creates their indexes there; live collections are then renamed to `*.previous` and the staging names are renamed into place. A failed staging write leaves live data unchanged. A failed rename rolls live names back from `*.previous`. Binding rematch runs only after the swap; per-user restore failures are skipped and reported instead of aborting the import or rolling back the new dataset. Existing user bindings are snapshotted by record fingerprint and restored when the contestant name and resolved school still match the user’s verified identity. Unmatched bindings are dropped.

Request `type Args={dataDir:string;dryrun?:boolean;allowPartial?:boolean}`, example `{"dataDir":"/opt/OIerDb/data","dryrun":false}`. `dataDir` must contain `school.txt`, `contests.json`, and `raw.txt` in the [OIerDb data format](https://github.com/OIerDb-ng/OIerDb/tree/master/data). Optional `grades.json` overrides built-in grade-name parsing. `dryrun` parses and reports counts without writing. Replacement is aborted when parsing produced warnings or skipped records unless `allowPartial` is true. The script streams progress through the usual manage-script record callback.

File formats:

- `school.txt`: `province,city,canonical,alias...` (`#` comments; empty rows keep id alignment)
- `contests.json`: array of `{name,type,year,fall_semester,full_score,capacity?}`
- `raw.txt`: nine CSV fields `contest,award,name,grade,school,score,province,gender,identifier`

Contestants with an empty identifier are merged using the OIerDb distance threshold (240). CCF levels follow the 2019 NOI mapping used by OIerDb.
