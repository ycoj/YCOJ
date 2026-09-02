---
name: ycoj-csp-preliminary-import
description: Import CSP preliminary-round papers into a local YCOJ preliminary training workflow using agent-browser, with correct grouping, numbering, prompts, and server binding.
---

# YCOJ CSP Preliminary Import

Use this skill when asked to open a CSP preliminary-round source page, scrape a paper, import it into the local YCOJ/Hydro preliminary-paper feature, or repair the resulting paper presentation.

## Workflow

1. Read the repository's `AGENTS.md` and the local YCOJ API skill. Backend route or schema changes must keep `.agents/skills/ycoj-api/` synchronized.
2. Use `agent-browser` with a dedicated named session. Load the core browser skill first. In restricted Linux containers, launch Chromium with `--args "--no-sandbox"`.
3. Open the requested source URL, select the requested level (for example, CSP-J), and capture the complete paper. Prefer a generated paper data asset or the page's network-loaded definition when available; it normally contains descriptions, options, scores, and answer keys that rendered text may omit. Never invent inaccessible statements or answers.
4. Map the source into `PaperDefinition`:
   - `title`, `content`, and `sections[]` with stable ASCII IDs;
   - choice options as `{ id: "A", text }` (or another unique option ID);
   - correct answer as the option ID; preserve scores and source Markdown/code;
   - put each question's complete prompt in `question.prompt`. Do not use placeholders such as “见本大题题干” or “详见本大题题干”.
5. Group sections according to the paper semantics. All single-choice questions belong to one first section. Program-reading and program-completion groups remain separate sections. Do not let source section boundaries create one-question sections merely because the source page paginates them.
6. Ensure display numbering is global across the whole paper. The answer-page question headings, result-page headings, and right-side quick-jump links must all run continuously (`1..N`) across sections, never restart at 1 for each section. Prefer adding a computed `questionNumber` in the backend response and rendering it in all relevant templates.
7. Import through the documented YCOJ preliminary-paper workflow when authenticated. For a local manual database import, use the existing MongoDB configured by `~/.hydro/config.json`, create the paper and immutable revision with the model's document types, and then read the paper back through HTTP. Avoid duplicate imports by checking the domain and title first.
8. Start the local server with `yarn start`. For externally reachable local access, persist `server.host = "0.0.0.0"` in the `system` settings collection (not the `document` collection), then restart the server. Keep the process running when the user asks for a server.

## Verification

- Read back the paper from `/preliminary/:paperId` and confirm section count, question count, total score, revision, and absence of public answer keys.
- Inspect the rendered HTML or use `agent-browser` to confirm quick-jump labels are exactly `1..N` and question prompts contain their own statements.
- Confirm the server log and `ss -ltnp` show `0.0.0.0:<port>` and make an HTTP request to the imported paper.
- If templates or backend handlers were changed, run the narrowest relevant tests/type checks and report any pre-existing failures separately.
