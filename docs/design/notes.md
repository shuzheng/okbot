# HTML notes (笔记)

## Product

When the user only wants notes (e.g. 「记一下我们聊的设计并维护着」):

1. Create/update a **`type=note`** resource: HTML file under the assistant `resources/` directory + a `resources.jsonl` row.
2. List / card UI: **hide file extension** (title without `.html`).
3. Chat bubble card: **top = one-shot live preview** of the HTML page, **bottom = filename/title (no suffix)**. Not a fixed title/summary template card.
4. Preview screenshot: **do not write a thumbnail to disk**. When the session loads that note message, render once (Electron offscreen `BrowserWindow` + `capturePage`; web falls back to a sandboxed iframe). No continuous refresh.
5. Same HTML is previewable/editable in the resources detail panel (iframe + HTML editor).
6. Model generates clean, professional, self-contained HTML (inline CSS; light/dark via `color-scheme` / `prefers-color-scheme` when feasible).
7. 「维护」= update the **same** note (`manage_note` update by id/path).
8. Host rejects `manage_note` **create** when a note with the same title already exists (same-topic gate); use update on the existing id/path.

## Storage

Reuses `resources.jsonl` / `resources/`. Note files use `.html`. No migration of legacy ad-hoc files or old markdown notes.

## Tool

`manage_note` (`create` | `update` | `list` | `get`). Default enabled + allow.

Boundary vs other tools:

- Timed / recurring → `manage_schedule`
- Actionable checklist → `manage_task_progress`
- Durable document to keep/maintain → `manage_note`

Do **not** dump the whole library into model context.

## Chat payload

Assistant message meta `noteCard: { resourceId, title }`. Host attaches after a successful create/update (same spirit as `ask_choice`).

## Deferred

- Note card click → jump to 资料库 detail
- Continuous / live-updating previews
- Thumbnail persistence
- Web clients without Electron capture (iframe fallback only)
