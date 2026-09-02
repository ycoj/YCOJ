# Preliminary Round Training API

Domain-scoped preliminary-round papers live under `/preliminary`. They use the existing problem permissions: view requires `PERM_VIEW_PROBLEM`, submission requires a logged-in profile plus `PERM_SUBMIT_PROBLEM`, creation requires `PERM_CREATE_PROBLEM`, and editing/deletion uses `PERM_EDIT_PROBLEM_SELF` for the owner or `PERM_EDIT_PROBLEM` for any paper.

- [Endpoint contracts](endpoints.md): paper/history lists, paper detail, create/edit/publish, submission, review, and deletion.
- [Route reference](routes.md): literal routes, POST operations, permissions, and lifecycle behavior.

Published saves create immutable revisions. Public paper responses omit correct answers and explanations. Attempt review reveals the correct answer for questions answered incorrectly or left unanswered, and includes an explanation only when the question has one.
