# `~/.okbot` on-disk schema

> **Keep in sync:** any change to files, fields, formats, or directory layout under the OkBot data root (`~/.okbot`) must update **this document in the same change**. Product behavior stays in [`GUIDE.md`](../../GUIDE.md); architecture boundaries stay in [`DESIGN.md`](../../DESIGN.md). Deeper feature design: [`resources.md`](./resources.md), [`tasks-status.md`](./tasks-status.md), [`run-watchdog.md`](./run-watchdog.md), [`notes.md`](./notes.md), [`message-reactions.md`](./message-reactions.md).

Canonical product inventory of what the app **reads and writes** under the gateway host data root (default `~/.okbot`). Values shown here are types and invariants only — never paste secrets, API keys, tokens, or message bodies into the repo.

Code sources of truth: `apps/gateway/src/storage/` (`FileStorage`, domain stores, `okbotLayout.ts`), `packages/shared/src/` (settings / resources / tasks / chat types), `apps/desktop/electron/clientSettings.ts` + `clientGatewayPrefs.ts`.

---

## 1. Directory tree

```text
~/.okbot/                          # chmod 0700 when FileStorage constructs
  client.json                      # machine-local Electron chrome (0600)
  server.json                      # gateway AppSettings (0600)
  runtime.json                     # single-owner process lock
  data/                            # durable gateway payload (chmod restricted)
    bots.json                      # roster: [{id,name,description}, …]
    squads.json                    # squad list (full Squad records)
    memory.md                      # global memories (JSONL lines in a .md file)
    usage.json                     # chat token totals
    api-token-usage.json           # per gateway API-token usage (optional until first use)
    logs/
      errors-YYYY-MM-DD.jsonl      # structured run errors (retain today + prior 2 days)
    <botId>/                       # bot_<yyyyMMdd>_<seq>
      bot.json
      SOUL.md
      memory.md
      session.jsonl
      session-summary.json
      skills/<slug>/SKILL.md       # + optional scripts/ references/ assets/ README.md
      resources.jsonl              # library index (created when first resource exists)
      resources/                   # ingested blobs (notes, images, …)
      uploads/                     # composer attachments
      temp/                        # tool cwd / throwaway artifacts
      tasks.jsonl                  # optional until first task
      schedules.jsonl              # optional until first schedule
      run-checkpoint.json          # optional mid-run checkpoint
      pending-hitl/<requestId>.json
      pending-hitl.json            # legacy single-file form (still read)
    <squadId>/                     # squad_<yyyyMMdd>_<seq>
      squad.json                   # dual-write {id,name,description} only
      session.jsonl
      session-summary.json
      resources.jsonl / resources/ / uploads/ / temp/
      tasks.jsonl / schedules.jsonl / run-checkpoint.json
      pending-hitl/…
      pending-hitl-replies/<turnId>.json
```

**Permissions:** root `0700`; `server.json` / `client.json` written `0600`. `data/` is restricted by `SettingsStore.restrictDataDir()`.

**Override:** `okbot serve --data-dir` + `--port` (pair required) can point at another root; local Electron always uses default `~/.okbot`.

---

## 2. Root files

### 2.1 `client.json`

| | |
| --- | --- |
| Format | JSON object, pretty-printed, mode `0600` |
| Writer | Electron (`apps/desktop/electron/clientSettings.ts`, `clientGatewayPrefs.ts`) |
| Reader | Electron main / preload; not part of gateway `AppSettings` |
| Backup | Skipped by gateway backup/restore |

**Shape:** `ClientSettings` plus optional nested extras:

```ts
{
  // ClientSettings (chrome)
  theme: 'system' | 'light' | 'dark';
  translucent: boolean;
  language: string;                 // UI language code
  microphoneId: string;             // '' = system default
  hardwareAcceleration: boolean;
  autoUpdate: boolean;
  sidebarDockMagnify: boolean;
  closeAction: string;              // e.g. 'ask' | 'quit' | 'tray'
  notifications: boolean;
  developerMode: boolean;
  settingsNavTab: string;
  settingsClientGroupExpanded: boolean;
  settingsGatewayGroupExpanded: boolean;

  // Nested (same file)
  window?: { x: number; y: number; width: number; height: number }; // width≥400, height≥300
  gateways?: {
    activeId: string;
    gateways: Array<{
      id: string;
      label: string;
      kind: 'local' | 'remote';
      baseUrl?: string;
      token?: string;               // secret
    }>;
  };
}
```

Web UI stores the chrome half in `localStorage` (`okbot.clientSettings`), not this file.

### 2.2 `server.json`

| | |
| --- | --- |
| Format | JSON `AppSettings` (gateway half), mode `0600` |
| Writer / reader | `SettingsStore` via `FileStorage` |
| Backup | Included (secrets optionally stripped) |

Top-level keys (final-state `AppSettings` after normalize — client chrome keys are stripped on write):

| Key | Type (summary) | Notes |
| --- | --- | --- |
| `timezone` | string | IANA; `''` = host local |
| `autoApprovalEnabled` | boolean | |
| `autoApprovalRules` | `AutoApprovalRule[]` | `{id, description, action:'allow'\|'ask', createdAt, updatedAt}`; ids `aar_…` |
| `tools` | `ToolPreferences` | per built-in tool `{enabled, approval}` |
| `security` | `SecuritySettings` | path/shell/agent guardrails |
| `model` | `ModelSettings` | `{providers[], defaultProviderId, defaultModelId}`; provider ids `prov_…`; **apiKey secret** |
| `contextCompression` | object | ratio / keepRecent* / summaryMaxChars / estimateSafetyFactor / autoTopicCompress |
| `instructions` | object | assistantRoleTemplate, soulMdRefreshSystemPrompt, skillsCreateUpdateInstruction |
| `memory` | object | scopeInstruction, promptMaxEntries, promptMaxChars |
| `maintenance` | object | soul/memory/skills turn+char throttles |
| `watchdog` | object | enabled, intervalMs, transientRetries |
| `squad` | object | captainPersona, playbook |
| `mesh` | object | reserved bag |
| `gatewayHttpApi` | object | port, bindLan, serveUi, `apiTokens[]` (**token secrets**), legacy `token`/`adminToken` mirrors |
| `computers` | `ComputerEntry[]` | remote sandbox agents; **token secrets**; ids `computer_…` |
| `defaultComputerId` | string | `'local'` or a computers id |
| `defaultAssistantId` | string | primary assistant bot id or `''` |
| `pinnedOwnerIds` / `hiddenOwnerIds` | string[] | owner ids |
| `ownerGroups` | `{id,name}[]` | group ids `ogroup_…` |
| `ownerGroupOrder` | string[] | includes virtual ungrouped id |
| `ownerGroupMembership` | `Record<ownerId, groupId>` | |
| `mcp` | `McpSettings` | `{enabled, servers[]}`; server env/headers **secrets** |
| `web` | `{search, fetch}` | search.apiKey **secret**; fetch.allowPrivateNetwork |
| `assistantMarketplace` | `{savedSources[]}` | remote package URLs |

Full TypeScript: `packages/shared/src/settings.ts` (+ `settingsModel.ts`, `mcp.ts`, `web.ts`, …). Disk may omit keys; normalize fills defaults. Loosely typed / forward-compatible fields should be documented here when added.

### 2.3 `runtime.json`

```ts
{ pid: number; port: number; owner: 'serve' | 'electron'; startedAt?: string; version?: string }
```

Process lock for single gateway listener on this data root. **Not** AppSettings. Skipped in backups.

---

## 3. `data/` shared files

### 3.1 `bots.json`

JSON array of roster rows (list UI source of truth for name/description):

```ts
Array<{ id: string; name: string; description: string }>
```

### 3.2 `squads.json`

JSON array of full `Squad` records:

```ts
Array<{
  id: string;
  name: string;
  description: string;
  members: Array<{ botId: string }>;
  providerId?: string;
  modelId?: string;
  createdAt: string;   // ISO
  updatedAt: string;
  hasUnreadReply?: boolean;
  // lastReplyPreview is UI-only and not persisted
}>
```

### 3.3 `memory.md` (global) and `<botId>/memory.md`

Markdown file whose **data lines** are JSON objects (comment lines start with `#`). Header on create:

```text
# OkBot Memory
# 每行一条 JSON：id / bot_id / memory / expires / tier / hits / pinned
```

Each data line:

```ts
{
  id: string;                 // typically mem_…
  bot_id: string;
  memory: string;             // required non-empty
  expires: string | null;     // ISO or null/omit = permanent
  tier?: 'candidate' | 'durable';  // missing → durable
  hits?: number;
  pinned?: boolean;           // omitted when false
  lastHitAt?: string | null;
  createdAt?: string | null;
}
```

Writer: `MemoryStore`. Expired rows are dropped on read; lifecycle pass may rewrite the file.

### 3.4 `usage.json`

```ts
{
  lifetime: { input: number; output: number; cache: number };
  daily: Record</* YYYY-MM-DD */ string, TokenUsage>;
  byOwner: Record<ownerId, TokenUsage>;
  dailyByOwner: Record<ownerId, Record<YYYY-MM-DD, TokenUsage>>;
  byModel: Record</* model id */ string, TokenUsage>;
}
```

### 3.5 `api-token-usage.json`

Created when gateway API-token chat metering first records:

```ts
{
  byTokenId: Record<tokenId, {
    lifetime: { messages: number; tokens: TokenUsage };
    daily: Record<YYYY-MM-DD, { messages: number; tokens: TokenUsage }>;
    byOwner: Record<ownerId, { messages: number; tokens: TokenUsage }>;
    dailyByOwner: Record<ownerId, Record<YYYY-MM-DD, …>>;
  }>;
}
```

### 3.6 `logs/errors-YYYY-MM-DD.jsonl`

Append-only JSONL. Retention: today + previous 2 calendar days.

```ts
{ ts: string; ownerId: string; messageId?: string; phase: 'chatStart'|'resumeHitl'|'resumeCheckpoint'|'squadChat'; error: string; stack?: string }
```

No user prompt text; sensitive substrings redacted.

---

## 4. Per-owner directory (`data/<ownerId>/`)

`ownerId` is either `bot_…` or `squad_…`. Path segment must not contain `..`, `/`, `\`, NUL, or newlines (`assertSafeOwnerSegment`).

### 4.1 Bot-only: `bot.json`

Full `BotConfig` dual-written with roster name/description:

```ts
{
  id: string;
  name: string;
  description: string;
  avatarKind: 'emoji' | 'bot-avatar';
  emoji: string;
  color: string;                  // '#RRGGBB' or ''
  botAvatarType?: string;         // when avatarKind === 'bot-avatar'
  createdAt: string;
  updatedAt: string;
  onboardingComplete: boolean;
  providerId?: string;
  modelId?: string;
  hasUnreadReply?: boolean;
  useGlobalSkills: boolean;
  enabledGlobalSkills: string[];  // global skill slugs
}
```

### 4.2 Squad-only: `squad.json`

Dual-write for folder self-containment — **only**:

```ts
{ id: string; name: string; description: string }
```

Members / model overrides live in `squads.json`, not here.

### 4.3 `SOUL.md` (bots only)

Markdown persona / system prompt body. Created with `DEFAULT_SOUL_MD` when the bot layout is ensured. Squads have no `SOUL.md`.

### 4.4 `skills/<slug>/` (bots only)

- `slug`: kebab-case, mandatory `okbot-` prefix, max 64 chars (`sanitizeSkillSlug`).
- Required: `SKILL.md` (YAML frontmatter `name` + `description`; body sections 何时使用此技能 / 工作原理 / 示例 / 注意事项).
- Optional: `scripts/`, `references/`, `assets/`, `README.md`.
- Global skills live under **`~/.agents/skills`** (outside this tree); bot only stores enable flags in `bot.json`.

### 4.5 `session.jsonl`

JSONL, one `SessionRecordV2` per line (atomic whole-file rewrite on some paths; append on others — see `sessionJsonl.ts` / `SessionStore`):

```ts
{
  v: 2;
  id: string;                 // typically msg_…
  createdAt: string;          // ISO
  item: Record<string, unknown>;  // AgentInputItem JSON (loose)
  meta?: {
    uiRole?: 'user' | 'assistant';
    speakerBotId?: string;
    meshExchange?: MeshExchangeMeta;
    meshInterim?: boolean;
    autoContinue?: boolean;
    quoteMessageId?: string;
    quotePreview?: string;
    attachments?: Array<{ kind: 'image'|'file'|'folder'; path: string; name: string; size?: number }>;
    usage?: { input: number; output: number; cache: number };
    trace?: MessageTrace;
    choice?: QuickChoice;
    noteCard?: { resourceId: string; title: string };
    reaction?: { emoji: string; from: 'user'|'assistant'; updatedAt: string };
    runId?: string;
  };
}
```

UI bubbles project from user/assistant text items + meta. Tool / SDK rows stay in `item` for model replay.

### 4.6 `session-summary.json`

```ts
{
  summary: string;
  coveredThroughId: string;
  updatedAt: string;
  lastEffectiveModel?: string;  // effectiveModelKey = baseURL + '\n' + modelId
}
```

### 4.7 `resources.jsonl` + `resources/`

Index: JSONL, one `OwnerResourceRecord` per line; whole-file rewrite. Ids are **ULID** (26 Crockford chars). See [`resources.md`](./resources.md).

```ts
{
  id: string;                 // ULID
  type: string;               // concrete: note | url | folder | md | pdf | png | … — never vague file/image
  title?: string;
  path: string;               // ingested file under resources/; external abs path; OR http(s) URL when type=url
  sourceMessageId?: string;
  createdBy: 'user' | 'assistant';
  createdAt: string;
  updatedAt: string;
  tags?: string[];            // max 32
}
```

List API adds derived (not persisted): `name`, `mime?`, `size?`, `assetRel?`, `ingested?`.

Blobs for ingested types live as files under `resources/`. Ad-hoc files already in `resources/` without an index row are **not** scanned.

### 4.8 `uploads/`

Composer paste/pick attachments. Filenames are unique (`<id>_<safeName>` style). Served at `/v1/media/<ownerId>/uploads/<file>`. Single file cap 25MB.

### 4.9 `temp/`

Default tool work directory (shell cwd / relative paths). Contents are throwaway; no schema.

### 4.10 `tasks.jsonl`

JSONL, one `TaskRecord` per line; whole-file rewrite. New task/step ids are **ULID**. See [`tasks-status.md`](./tasks-status.md).

```ts
{
  v: 1;
  id: string;
  title?: string;
  status: 'backlog' | 'pending' | 'in_progress' | 'done';
  note?: string;
  steps: Array<{
    id: string;
    title: string;
    status: 'pending'|'in_progress'|'blocked'|'succeeded'|'failed'|'cancelled';
    note?: string;
    startedAt?: string;
    endedAt?: string;
    updatedAt?: string;
  }>;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
}
```

### 4.11 `schedules.jsonl`

JSONL, **one job object per line** (not a wrapper). New job ids are **ULID**. Max 50 jobs per owner.

```ts
{
  id: string;
  ownerId: string;
  title: string;
  prompt: string;
  enabled: boolean;
  timezone: string;           // IANA or ''
  schedule:
    | { kind: 'daily'; hour: number; minute: number }
    | { kind: 'hourly'; minute: number }
    | { kind: 'cron'; expr: string };
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  once: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 4.12 `run-checkpoint.json`

At most one latest mid-run SDK checkpoint per owner. Absent when idle. See [`run-watchdog.md`](./run-watchdog.md).

```ts
{
  v: 1;
  ownerId: string;
  kind: 'bot' | 'squad';
  runId: string;
  messageId: string;
  serializedRunState: string;   // opaque SDK blob — treat as secret-ish
  computerId?: string;
  userText?: string;
  autoResumeEligible?: boolean; // false → Watchdog skips; missing → eligible
  createdAt: string;
  updatedAt: string;
}
```

### 4.13 `pending-hitl/`

One JSON file per outstanding tool approval: `pending-hitl/<requestId>.json`.

```ts
{
  v: 1;
  requestId: string;
  messageId: string;
  toolName: string;
  callId?: string;
  arguments: unknown;
  serializedRunState: string;
  computerId?: string;
  userText?: string;
  squadMember?: { botId: string; toolName: string; task: string };
  turnId?: string;
  createdAt: string;
}
```

Legacy `pending-hitl.json` (single object or array) is still read if present.

Squad cold-resume collected member replies: `pending-hitl-replies/<turnId>.json` (JSON; shape owned by `squadResume` — array/object of reply payloads).

---

## 5. ID and filename conventions

| Kind | Pattern | Generator |
| --- | --- | --- |
| Bot id / dir | `bot_<yyyyMMdd>_<seq>` (seq 1–999 zero-padded to 3) | `formatBotId` |
| Squad id / dir | `squad_<yyyyMMdd>_<seq>` | `formatSquadId` |
| Prefixed random | `<prefix>_<16 hex>` | `createId(prefix)` — common prefixes: `msg`, `run`, `mem`, `aar`, `prov`, `computer`, `ogroup`, `mesh`, `span`, `evt`, `tool` |
| ULID | 26 Crockford base32 | `createUlid` — **tasks**, **resources**, **schedules** (new) |
| Skill slug | `okbot-…` kebab, ≤64 | `sanitizeSkillSlug` |
| Error log file | `errors-YYYY-MM-DD.jsonl` | calendar local date |
| Media URL | `/v1/media/<ownerId>/{resources\|uploads}/<file>` | gateway |

ISO timestamps are UTC `Date.toISOString()` unless noted.

---

## 6. What is *not* stored under `~/.okbot`

| Location / concern | Where it actually lives |
| --- | --- |
| Global Agent Skills catalog | `~/.agents/skills` (referenced by `bot.json.useGlobalSkills`) |
| Electron app binaries / `userData` caches | Electron `app.getPath('userData')` (legacy seed files only) |
| Web UI chrome prefs | Browser `localStorage` (`okbot.clientSettings`, immersive chat key, …) |
| Immersive-chat / pure UI toggles | `localStorage`, not `client.json` |
| sandbox-agent state | Remote computer host (not the gateway `~/.okbot`) |
| Public GitHub releases / changelogs | App package + GitHub Releases |
| Separate peer/mesh session files | Mesh meta is only `session.jsonl` `meta.meshExchange` |
| SQLite / other DB | None — file JSON/JSONL/Markdown only |

Leftover root names that may exist but are **not** the live config surface: `window.json`, `gateways.json`, `settings.json`, `client-settings.json`, `client-gateways.json`, `restore-notice.json` (one-shot post-restore notice; deleted after read). Backup sidecar next to the root: `<okbotDir>-before-restore-<time>/`.

---

## 7. Readers / writers (quick map)

| Path | Primary module |
| --- | --- |
| Layout / migration into `data/` | `okbotLayout.ts` |
| Facade | `FileStorage.ts` |
| `server.json` | `SettingsStore.ts` |
| `client.json` | `apps/desktop/electron/clientSettings.ts` |
| Roster / `bot.json` / `squad.json` / SOUL | `RosterStore.ts` |
| Sessions | `SessionStore.ts` + `sessionJsonl.ts` |
| Memory / session-summary | `MemoryStore.ts` |
| Skills | `SkillsStore.ts` |
| Resources | `ResourceStore.ts` |
| Tasks | `TaskProgressStore.ts` |
| Schedules | `ScheduleStore.ts` + `schedules.ts` |
| HITL | `PendingHitlStore.ts` |
| Run checkpoint | `RunCheckpointStore.ts` |
| Usage | `usageStore.ts` / `apiTokenUsageStore.ts` |
| Error logs | `errorLog.ts` |
| Backup zip | `apps/gateway/src/backup.ts` |

---

## 8. Maintenance rule

Changing any of the following requires updating this file **in the same change**:

- New/removed/renamed path under `~/.okbot`
- New/removed/renamed JSON/JSONL field that is persisted
- ID format or filename convention
- File format switch (e.g. JSON ↔ JSONL)
- “Not stored here” boundaries

Also update `AGENTS.md` / `GUIDE.md` / `DESIGN.md` cross-links when the doc moves or the tree overview in those handbooks drifts. Do not document migration history here — final-state only.
