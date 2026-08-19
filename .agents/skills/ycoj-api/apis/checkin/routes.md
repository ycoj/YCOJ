# Check-in route reference

The package registers only `POST /checkin`; it requires `PRIV_USER_PROFILE`, accepts an empty JSON object, and returns the idempotent `{created,record,streak}` model described in [README.md](./README.md).
