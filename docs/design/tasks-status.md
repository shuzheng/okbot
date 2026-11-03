# Task status redesign (authoritative)

## Task statuses (4)

- `backlog` — pool / not started (explicit only; never derived back once steps drive status)
- `pending` — ready, not actively running
- `in_progress` — actively running
- `done` — finished only (NOT success/fail/cancel)

Legacy task `cancelled` / `failed` migrate → `done` on load.

## Step statuses (6) — no backlog

In-progress phase: `pending` | `in_progress` | `blocked`  
Terminal: `succeeded` | `failed` | `cancelled`

Legacy step `done` migrates → `succeeded` on load.

## Derivation (steps → task), priority stop-on-match

1. Any step `in_progress` → task `in_progress`
2. Else any step `blocked` → task `in_progress`
3. Else all steps terminal → task `done`
4. Else all steps `pending` → task `pending`
5. Else (mix with remaining pending) → task `in_progress`

Hard rules:

- `backlog` only on task; only via explicit set
- While task is `backlog`, reject putting a step into `in_progress` (leave pool first)
- User cancel whole task: all non-terminal steps → `cancelled`; task → `done` (explicit `status=done`)
- Explicit task `done` wins over derivation
- `backlog` → `pending` only explicit (UI / tool / clear intent); never auto on restore/list/continue

## UI

1. Chat 「进行中的任务」 / `OpenTasksPanel`: only `status === 'in_progress'`
2. Assistant detail Tasks: 未做 (`backlog`) / 进行中 (`pending`+`in_progress`) / 结束 (`done`); manual delete only for backlog

## Auto-continue

- `hasUnfinishedTasks`: includes backlog / blocked as unfinished
- `canAutoContinueTasks`: actionable pending/in_progress only; **pause** while any step is `blocked`; backlog does not drive continue

## Storage

Keep `~/.okbot/<owner>/tasks.jsonl` (full rewrite OK). SQLite later — not now.

## Schedule vs task routing

- Explicit time/period (明天9点、每周一、cron, etc.) → `manage_schedule` (do not create a task).
- Do-now / backlog with no schedule → `manage_task_progress` (may use `backlog`).
- Schedule wake semantics unchanged: 到点后会像用户发消息一样唤醒一轮对话.

## Soft-steer resume context (layer 1)

When composer soft-steer aborts in-flight owner runs (or cold restore / checkpoint resume), the host injects an invisible system block (`resumeContextText` via `buildInterruptedRunResumeContext`):

- Unfinished `manage_task_progress` / current task state (same source as the usual task prompt section)
- Existing owner resources: path + title + type (newest first; capped)
- Explicit note: prior run interrupted — continue / edit same paths; do not recreate
- Soft-steer **and manual Stop**: keep mid-run `run-checkpoint.json` across abort/Stop; soft-steer replacement **or** a later composer continue loads it (consume-once), resumes via `resumeAgentChatFromCheckpoint` when present, and injects a tool-call digest + interrupt user text into the resume block (`soft_steer` or `manual_stop` reason). Successful done / consume-once / force-quit / soft-steer fail-before-consume still clear. Soft-steer handoff *flag* is still cleared on Stop so no racing replacement starts; the file remains for「继续」.

Wired in `orchestrateBotTurn` (`softSteered`) → `startBotTurn`, and in `coldRestoreBot` / `coldRestoreCheckpoint`. Not a user-visible bubble. Layer 3 (true queue / no-abort) is out of scope.

**Run Watchdog (P0–P2):** transient mid-turn failures keep the checkpoint and retry model segments (default 3). A process-global Watchdog (default **30s**, `settings.watchdog`) silently resumes safe bot+squad checkpoints when the run is gone / heartbeat-dead. Stop sets `autoResumeEligible: false` (composer「继续」still works). See `docs/design/run-watchdog.md`.

