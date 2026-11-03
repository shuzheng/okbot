# Run Watchdog + transient checkpoint keep

## Goals

1. **P0** — Mid-turn transient LLM/HTTP/network/timeout failures **keep** `run-checkpoint.json` and retry the model segment a few times in-turn (default **3** attempts). Permanent errors, Abort/Stop, and soft-steer paths stay as before.
2. **P1** — Global **Watchdog** watches busy / checkpointed owners. If a run is gone or heartbeat-timed-out and a **safe** checkpoint remains → **silent** resume.
3. **P2** — Squad captain checkpoints are included in silent/cold auto-resume. Interval is configurable (`settings.watchdog.intervalMs`, default **30000**).

## Settings (`settings.json` → `watchdog`)

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | Master switch |
| `intervalMs` | `30000` | Poll interval; clamp 5s–300s |
| `transientRetries` | `3` | Per model-segment attempts (incl. first) |

## Hard gates (no silent resume)

- Manual **Stop** → checkpoint kept for composer「继续」, but `autoResumeEligible: false`
- Soft-steer handoff in flight
- Pending HITL cards
- Still-alive run (fresh heartbeat); heartbeat timeout aborts stale registration first

## Key modules

- `packages/shared` — `isTransientRunError`, `WatchdogSettings`
- `packages/agent` — `runModelSegment` retries; `resumeSquadChatFromCheckpoint`
- `apps/gateway` — `shouldKeepRunCheckpointOnTurnEnd({ transientFailure })`, `runWatchdog.ts`, `resumeOwnerFromCheckpoint`
