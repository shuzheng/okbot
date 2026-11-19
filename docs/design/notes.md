# HTML notes (笔记)

## Product

Whenever the deliverable is a plan (规划), design draft (设计稿), report (报告), record (记录), note (笔记), or similar persistent document, use `manage_note`. Do not wait for the user to literally say 「记一下」.

When creating or maintaining that document:

1. Create/update a **`type=note`** resource: HTML file under the assistant `resources/` directory + a `resources.jsonl` row.
2. List / card UI: **hide file extension** (title without `.html`).
3. Chat bubble card: **top = one-shot live preview** of the HTML page, **bottom = filename/title (no suffix)**. Not a fixed title/summary template card.
4. Preview screenshot: **do not write a thumbnail to disk**. When the session loads that note message, render once (Electron offscreen `BrowserWindow` + `capturePage`; web falls back to a sandboxed iframe). No continuous refresh.
5. Same HTML is previewable/editable in the resources detail panel (iframe + HTML editor).
6. Model generates clean, professional, self-contained HTML (inline CSS). Theme must follow the OkBot client: the preview host sets and updates `data-theme="light|dark"` on the note document's `<html>` to match the resolved in-app theme. Style both schemes with `:root[data-theme="light"]` and `:root[data-theme="dark"]`. Do not rely only on `prefers-color-scheme` (it can disagree with the in-app theme, especially on web). Preview sandbox does not allow scripts.
7. 「维护」= update the **same** note (`manage_note` update by id/path).
8. Host rejects `manage_note` **create** when a note with the same title already exists (same-topic gate); use update on the existing id/path.

## Storage

Reuses `resources.jsonl` / `resources/`. Note files use `.html`. No migration of legacy ad-hoc files or old markdown notes.

## Tool

`manage_note` (`create` | `update` | `list` | `get`). Default enabled + allow.

Boundary vs other tools:

- Timed / recurring → `manage_schedule`
- Actionable checklist → `manage_task_progress`
- Plan, design draft, report, record, note, or similar durable document → `manage_note`

Do **not** dump the whole library into model context.

## Chat payload

Assistant message meta `noteCard: { resourceId, title }`. Host attaches after a successful create/update (same spirit as `ask_choice`).

## Deferred

- Note card click → jump to 资料库 detail
- Continuous / live-updating previews
- Thumbnail persistence
- Web clients without Electron capture (iframe fallback only)
