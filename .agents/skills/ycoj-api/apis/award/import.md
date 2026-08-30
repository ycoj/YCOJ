# Award import script

This is not an HTTP route. Super administrators with `PRIV_EDIT_SYSTEM` run it from `POST /manage/script` (`id` `importOier`) or `hydrooj cli script importOier '<json>'`.

## `importOier`

Description: parse an OIerDb `data/` directory and replace the `oier`, `oier.record`, `oier.school`, and `oier.contest` collections. Existing user bindings are snapshotted by record fingerprint and restored when the contestant name still matches the user’s verified `realName`. Unmatched bindings are dropped.

Request `type Args={dataDir:string;dryrun?:boolean}`, example `{"dataDir":"/opt/OIerDb/data","dryrun":false}`. `dataDir` must contain `school.txt`, `contests.json`, and `raw.txt` in the [OIerDb data format](https://github.com/OIerDb-ng/OIerDb/tree/master/data). Optional `grades.json` and `scoring.json` override built-in defaults. `dryrun` parses and reports counts without writing. The script streams progress through the usual manage-script record callback.

File formats:

- `school.txt`: `province,city,canonical,alias...` (`#` comments; empty rows keep id alignment)
- `contests.json`: array of `{name,type,year,fall_semester,full_score,capacity?}`
- `raw.txt`: nine CSV fields `contest,award,name,grade,school,score,province,gender,identifier`

Contestants with an empty identifier are merged using the OIerDb distance threshold (240). CCF levels follow the 2019 NOI mapping used by OIerDb.
