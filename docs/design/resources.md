# Resources library (资料库)

## Product

Per-assistant light notes/KB attachment cabinet. Conversation remains the primary entry; assistant detail **资料库** is a weak entry. Not an independent notes product and not a WeChat-style feature rail.

## Storage (breaking — no old-data compat)

Path: `~/.okbot/data/<ownerId>/resources.jsonl` (one JSON object per line; id = ULID).

Physical ingested files live under `~/.okbot/data/<ownerId>/resources/`; metadata `path` points there.

External folder/file links: metadata only (`path` absolute), no copy.

`type === 'url'`: store the URL string in `path` (same field; documented here).

New versions load **only** from `resources.jsonl`. Do **not** scan or migrate ad-hoc files already sitting in `resources/`. Fresh install / upgrade → empty library until new items are added.

Whole-file read/write is fine for now (same spirit as `tasks.jsonl`). SQLite may come later with tasks.

## Record schema

| Field | Notes |
| --- | --- |
| `id` | ULID |
| `type` | Concrete: `note` \| `url` \| `folder` \| extension-like `md` \| `pdf` \| `png` \| `jpg` \| `mp4` \| `txt` \| … — **never** vague `file` / `image` |
| `title?` | Default filename/folder name; URL may use host/title; editable later |
| `path` | Ingested → under `resources/`; external → absolute; URL → URL string |
| `sourceMessageId?` | Optional; **no** `sourceSessionId` (assistant-private isolation) |
| `createdBy` | `user` \| `assistant` |
| `createdAt` / `updatedAt` | ISO |
| `tags?` | Optional; stubbed / unused in early UI |

List IPC returns the record plus derived `name`, `mime`, `size?`, `assetRel?`, `ingested?` (not persisted).

## Context injection

Default: **do not** dump the whole library into model context. On-demand retrieval can come later; v1 indexes on ingest (e.g. `generate_image` / local `write_file` → `indexOwnerResourceFile`).

## Same-topic create gate (layer 2)

For this owner, host rejects:

- `write_file` **create** of a new path under `resources/` when a library row already has the same basename/title (e.g. second `贪吃蛇游戏.html`). Same-path overwrite stays allowed; tell the model to `edit_file` / overwrite the existing path.
- `manage_note` **create** when a note with the same title already exists; tell the model to `manage_note` update with the existing id/path.

Intentional `edit_file` / `manage_note` update are not blocked. See `apps/gateway/src/ipc/sameTopicArtifactGate.ts`.

Soft-steer / cold-restore turns also inject a short resources inventory into system context (see `docs/design/tasks-status.md` soft-steer resume). Still do not dump the whole library on every ordinary turn.


## Preview matrix

Embeddable kinds open a **fullscreen overlay** (same chrome as the chat image lightbox): download + close; **no** zoom (images keep zoom). Notes still have no thumbnail disk write.

| Kind | Behavior |
| --- | --- |
| `md` | Fullscreen: `react-markdown` + `remark-gfm` (same stack as chat `MarkdownContent`) |
| `note` | Fullscreen: sandboxed iframe preview + HTML edit. Chat: one-shot capture card (see `docs/design/notes.md`). |
| code / text (`js`, `css`, `txt`, …) | Fullscreen: `highlight.js` github-dark (same langs as chat). Plain text preview — **not** run as a page |
| `html` (non-note) | No iframe/webview browser embed. Skip fancy preview if weui unavailable |
| images | Existing lightbox / media gateway patterns (zoom + download) |
| pdf / common AV | System open / reveal (no Chromium office embed) |
| external folder/file | Finder / Explorer via `shell.showItemInFolder` / `openPath` |
| archives / office | System open / download — no embed |

## Ingest paths (landed)

- Detail panel: new note, add URL, add folder link, link file, ingest (copy) file
- `generate_image` save → `onGeneratedImageSaved` → `resources.jsonl` index
- Local `write_file` / `edit_file` under owner `resources/` → same `onSaved` → `resources.jsonl` index (`type` from extension, e.g. `md`)
- Assistant reply persist: markdown `![…](/v1/media/<owner>/resources/<file>)` → `indexOwnerResourceFile` (covers shell/other binary writes that still surface in chat)
- Delete: ingested file under `resources/` → metadata + unlink; external/URL → metadata only

## Deferred

- Bubble action 「收入资料库」
- Drag/drop/paste onto the detail panel
- Tags UI / full-text search
- URL title crawl
- SQLite migration
