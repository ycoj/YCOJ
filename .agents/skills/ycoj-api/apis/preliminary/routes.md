# Preliminary Round Training route reference

The module registers five domain-scoped routes:

| Route | Methods and operations | Access |
| --- | --- | --- |
| `/preliminary` | `GET` paper list or personal attempt history | `PERM_VIEW_PROBLEM`; attempt history additionally requires a logged-in profile |
| `/preliminary/create` | `GET`; `POST` operation `save` | `PERM_CREATE_PROBLEM` |
| `/preliminary/:paperId` | `GET`; `POST` operations `submit`, `delete` | View permission; submission uses profile + submit permission; deletion uses corresponding problem edit permission |
| `/preliminary/:paperId/edit` | `GET`; `POST` operation `save` | Owner with `PERM_EDIT_PROBLEM_SELF`, or `PERM_EDIT_PROBLEM` |
| `/preliminary/:paperId/attempt/:attemptId` | `GET` | Attempt owner only, with `PERM_VIEW_PROBLEM` and a logged-in profile |

Drafts are visible only to their owner and users with edit-any permission. Saving with `published:true` validates a complete paper, creates an immutable revision, and immediately makes that revision active. Saving with `published:false` stores a draft or unpublishes the paper. Deletion cascades to all revisions and attempts.
