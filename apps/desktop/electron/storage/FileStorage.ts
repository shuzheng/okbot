import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_SETTINGS,
  DEFAULT_AGENTS_MD,
  MESSAGE_PAGE_SIZE,
  createId,
  plainTextFromMarkdown,
  type AppSettings,
  type AutoApprovalRule,
  type AutoApprovalAction,
  normalizeToolPreferences,
  type Bot,
  type BotConfig,
  type BotOnboardingAnswers,
  type BotSkill,
  type MemoryEntry,
  type SessionSummary,
  normalizeModelSettings,
  resolveModelRef,
  type ModelRef,
  normalizeContextCompression,
  normalizeMaxTurns,
  normalizeSecuritySettings,
  normalizeSquadSettings,
  normalizeInstructionsSettings,
  LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT,
  LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD,
  LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA,
  LEGACY_DEFAULT_SQUAD_PLAYBOOK,
  normalizeMemorySettings,
  normalizeToolRunSettings,
  normalizeSquad,
  clampSessionSummary,
  stripThinkContent,
  type BotRosterEntry,
  type ChatMessage,
  type Squad,
  type SquadMember,
  type CreateSquadInput,
  type MessagesPage,
  type MessageSearchHit,
  normalizeBotAvatarKind,
  normalizeBotAvatarType,
  type BotAvatarKind,
  type BotAvatarShape,
  type TokenUsage,
  type UsageStats,
  type SessionsChangedReason,
  normalizeLocalHttpApiSettings,
  normalizeComputers,
  normalizeDefaultComputerId,
} from '@okbot/shared';
import {
  parseSkillMarkdown,
  formatSkillMarkdown,
  formatSkillCatalog,
  buildSkillCatalogEntries,
  buildAssistantPackage,
  parseAssistantPackage,
  assistantPackageToFileMap,
  stripSecrets,
  type AssistantPackageContents,
} from '@okbot/agent';
import { ensureDir, readJson, readJsonResult, backupFileAside, writeJson } from './fs';
import { loadUsageStats, recordTokenUsage, removeOwnerUsage } from './usageStore';
import {
  isSessionRecordV2,
  isLegacyChatMessage,
  legacyMessageToRecord,
  mergeUiMessageOntoRecord,
  recordToUiMessage,
  parseSessionLine,
  writeSessionRecordsAtomic,
  readJsonlPage,
} from './sessionJsonl';
import {
  normalizeAutoApprovalRules,
  localDateYyyyMmDd,
  formatBotId,
  parseBotIdSeqForDate,
  formatSquadId,
  parseSquadIdSeqForDate,
  isSquadOwnerId,
  assertSafeOwnerSegment,
  sanitizeSkillSlug,
} from './ids';
import type { SessionRecordV2, PendingHitlRecord } from './types';
import {
  writeAssistantPackageDir,
  readAssistantPackageDir,
  zipAssistantPackage,
  readAssistantPackageArchive,
} from './assistantPackageIo';
import { readLastRunTrace, markAbandonedIfRunning, type RunTraceFile } from './runTrace';

export type { SessionRecordV2, PendingHitlRecord } from './types';

export class FileStorage {
  readonly root: string;
  private botsPath: string;
  private squadsPath: string;
  private settingsPath: string;
  /** One-shot warning after corrupt settings.json (shown on bootstrap). */
  private settingsLoadWarning: string | null = null;
  /** Main process fans this out as RuntimeEvent sessions_changed. */
  private sessionsChangedListener:
    | ((ownerId: string, reason: SessionsChangedReason) => void)
    | null = null;
  private settingsCorruptHandled = false;
  private windowPath: string;
  private usagePath: string;

  constructor(root?: string) {
    this.root = root ?? path.join(os.homedir(), '.okbot');
    this.botsPath = path.join(this.root, 'bots.json');
    this.squadsPath = path.join(this.root, 'squads.json');
    this.settingsPath = path.join(this.root, 'settings.json');
    this.windowPath = path.join(this.root, 'window.json');
    this.usagePath = path.join(this.root, 'usage.json');
    ensureDir(this.root);
    if (!fs.existsSync(this.botsPath)) writeJson(this.botsPath, [] as BotRosterEntry[]);
    if (!fs.existsSync(this.squadsPath)) writeJson(this.squadsPath, [] as Squad[]);
    if (!fs.existsSync(this.settingsPath)) this.writeSettingsFile(DEFAULT_SETTINGS);
    this.ensureMemoryFile(this.globalMemoryPath());
  }

  /** Desktop main registers this so Electron and the gateway share one roster signal. */
  setSessionsChangedListener(
    listener: ((ownerId: string, reason: SessionsChangedReason) => void) | null,
  ): void {
    this.sessionsChangedListener = listener;
  }

  private noteSessionsChanged(ownerId: string, reason: SessionsChangedReason): void {
    const id = (ownerId || '').trim();
    if (!id || !this.sessionsChangedListener) return;
    try {
      this.sessionsChangedListener(id, reason);
    } catch (err) {
      console.error('[okbot] sessions_changed listener failed', err);
    }
  }

  /** `~/.okbot/<botId>` */
  private botDir(botId: string): string {
    return path.join(this.root, botId);
  }

  /** Reject path-escape / unknown owner ids from renderer IPC. */
  assertKnownBotId(botId: string): void {
    const id = assertSafeOwnerSegment(botId);
    if (isSquadOwnerId(id)) throw new Error(`助手不存在：${id}`);
    if (!this.listRoster().some((b) => b.id === id)) {
      throw new Error(`助手不存在：${id}`);
    }
  }

  /** Bot or squad owner that already exists on disk / roster. */
  assertKnownOwnerId(ownerId: string): void {
    const id = assertSafeOwnerSegment(ownerId);
    if (isSquadOwnerId(id)) {
      const known = this.collectKnownSquadIds();
      if (!known.has(id) && !fs.existsSync(this.squadDir(id))) {
        throw new Error(`小队不存在：${id}`);
      }
      return;
    }
    this.assertKnownBotId(id);
  }

  /** `~/.okbot/<botId>/session.jsonl` — one chat transcript per bot. */
  private sessionFile(botId: string): string {
    return path.join(this.botDir(botId), 'session.jsonl');
  }

  /** `~/.okbot/<botId>/pending-hitl.json` — at most one pending tool approval (V1). */
  private pendingHitlFile(botId: string): string {
    return path.join(this.botDir(botId), 'pending-hitl.json');
  }

  /** `~/.okbot/<botId>/skills` */
  private botSkillsDir(botId: string): string {
    return path.join(this.botDir(botId), 'skills');
  }

  /** Public path for skill hot-reload watchers. */
  botSkillsDirPublic(botId: string): string {
    this.assertKnownBotId(botId);
    return this.botSkillsDir(botId);
  }

  /** Public `~/.agents/skills` for hot-reload. */
  globalAgentsSkillsDirPublic(): string {
    return this.globalAgentsSkillsDir();
  }

  /** `~/.okbot/<botId>/resources` */
  private botResourcesDir(botId: string): string {
    return path.join(this.botDir(botId), 'resources');
  }

  private agentsMdPath(botId: string): string {
    return path.join(this.botDir(botId), 'AGENTS.md');
  }

  private ensureBotLayout(botId: string): void {
    if (isSquadOwnerId(botId)) {
      this.ensureSquadLayout(botId);
      return;
    }
    ensureDir(this.botDir(botId));
    ensureDir(this.botSkillsDir(botId));
    ensureDir(this.botResourcesDir(botId));
    const agents = this.agentsMdPath(botId);
    if (!fs.existsSync(agents)) {
      fs.writeFileSync(agents, DEFAULT_AGENTS_MD, 'utf8');
    }
    this.ensureMemoryFile(this.botMemoryPath(botId));
  }


  /** `~/.okbot/<squadId>` — session + pending HITL + resources (no AGENTS/skills). */
  private squadDir(squadId: string): string {
    return path.join(this.root, squadId);
  }

  private ensureSquadLayout(squadId: string): void {
    ensureDir(this.squadDir(squadId));
    ensureDir(path.join(this.squadDir(squadId), 'resources'));
    const sf = this.sessionFile(squadId);
    if (!fs.existsSync(sf)) fs.writeFileSync(sf, '', 'utf8');
  }

  /** Bot full layout, or squad session layout. */
  private ensureChatLayout(ownerId: string): void {
    if (isSquadOwnerId(ownerId)) {
      this.ensureSquadLayout(ownerId);
      return;
    }
    this.ensureBotLayout(ownerId);
  }

  readAgentsMd(botId: string): string {
    this.assertKnownBotId(botId);
    this.ensureBotLayout(botId);
    return fs.readFileSync(this.agentsMdPath(botId), 'utf8');
  }

  writeAgentsMd(botId: string, content: string): void {
    this.assertKnownBotId(botId);
    this.ensureBotLayout(botId);
    // Never persist model CoT into system instructions (refresh / UI / sync).
    const stripped = stripThinkContent(typeof content === 'string' ? content : '').trimEnd();
    const text = stripped.endsWith('\n') ? stripped : `${stripped}\n`;
    fs.writeFileSync(this.agentsMdPath(botId), text, 'utf8');
  }



  private globalMemoryPath(): string {
    return path.join(this.root, 'memory.md');
  }

  private botMemoryPath(botId: string): string {
    return path.join(this.botDir(botId), 'memory.md');
  }

  private ensureMemoryFile(file: string): void {
    ensureDir(path.dirname(file));
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        [
          '# OkBot Memory',
          '# 每行一条 JSON：id / bot_id / memory / expires（ISO 或 null）',
          '',
        ].join('\n'),
        'utf8',
      );
    }
  }

  private readMemoryFile(file: string): MemoryEntry[] {
    this.ensureMemoryFile(file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const out: MemoryEntry[] = [];
    const now = Date.now();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('{')) continue;
      try {
        const row = JSON.parse(trimmed) as Partial<MemoryEntry>;
        if (!row.id || !row.bot_id || typeof row.memory !== 'string' || !row.memory.trim()) continue;
        const expires = row.expires == null || row.expires === '' ? null : String(row.expires);
        if (expires) {
          const ts = Date.parse(expires);
          if (Number.isFinite(ts) && ts <= now) continue;
        }
        out.push({
          id: String(row.id),
          bot_id: String(row.bot_id),
          memory: row.memory.trim(),
          expires,
        });
      } catch {
        /* skip */
      }
    }
    return out;
  }

  private writeMemoryFile(file: string, entries: MemoryEntry[]): void {
    this.ensureMemoryFile(file);
    const header = [
      '# OkBot Memory',
      '# 每行一条 JSON：id / bot_id / memory / expires（ISO 或 null）',
      '',
    ];
    const body = entries.map((e) =>
      JSON.stringify({
        id: e.id,
        bot_id: e.bot_id,
        memory: e.memory,
        expires: e.expires,
      }),
    );
    fs.writeFileSync(file, `${header.join('\n')}${body.join('\n')}${body.length ? '\n' : ''}`, 'utf8');
  }

  listGlobalMemories(): MemoryEntry[] {
    return this.readMemoryFile(this.globalMemoryPath());
  }

  listBotMemories(botId: string): MemoryEntry[] {
    this.assertKnownBotId(botId);
    this.ensureBotLayout(botId);
    return this.readMemoryFile(this.botMemoryPath(botId));
  }

  /** Upsert by id into global or bot memory.md */
  upsertMemory(scope: 'global' | 'bot', entry: MemoryEntry): void {
    if (scope === 'bot') this.assertKnownBotId(entry.bot_id);
    const file = scope === 'global' ? this.globalMemoryPath() : this.botMemoryPath(entry.bot_id);
    if (scope === 'bot') this.ensureBotLayout(entry.bot_id);
    const list = this.readMemoryFile(file);
    const idx = list.findIndex((e) => e.id === entry.id);
    const next: MemoryEntry = {
      id: entry.id,
      bot_id: entry.bot_id,
      memory: stripThinkContent(entry.memory).trim(),
      expires: entry.expires,
    };
    if (idx >= 0) list[idx] = next;
    else list.push(next);
    this.writeMemoryFile(file, list);
  }

  /** Delete a memory row by id from global or bot memory.md. */
  deleteMemory(scope: 'global' | 'bot', botId: string, memoryId: string): void {
    if (scope === 'bot') this.assertKnownBotId(botId);
    const file = scope === 'global' ? this.globalMemoryPath() : this.botMemoryPath(botId);
    if (scope === 'bot') this.ensureBotLayout(botId);
    const list = this.readMemoryFile(file).filter((e) => e.id !== memoryId);
    this.writeMemoryFile(file, list);
  }


  private sessionSummaryPath(botId: string): string {
    return path.join(this.botDir(botId), 'session-summary.json');
  }

  readSessionSummary(botId: string): SessionSummary | null {
    const file = this.sessionSummaryPath(botId);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SessionSummary>;
      const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
      const coveredThroughId = typeof raw.coveredThroughId === 'string' ? raw.coveredThroughId : '';
      if (!summary || !coveredThroughId) return null;
      return {
        summary,
        coveredThroughId,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  writeSessionSummary(botId: string, entry: SessionSummary): void {
    this.ensureBotLayout(botId);
    const maxChars = normalizeContextCompression(
      this.getSettings().contextCompression,
    ).summaryMaxChars;
    const next: SessionSummary = {
      summary: clampSessionSummary(stripThinkContent(entry.summary), maxChars),
      coveredThroughId: entry.coveredThroughId,
      updatedAt: entry.updatedAt || new Date().toISOString(),
    };
    writeJson(this.sessionSummaryPath(botId), next);
  }

  formatMemoriesForPrompt(botId: string): string {
    const global = this.listGlobalMemories();
    const local = this.listBotMemories(botId);
    const parts: string[] = [];
    if (global.length) {
      parts.push(
        ['### 全局记忆', '', ...global.map((e) => `- [${e.id}] ${e.memory}${e.expires ? `（过期 ${e.expires}）` : ''}`)].join(
          '\n',
        ),
      );
    }
    if (local.length) {
      parts.push(
        [
          '### 本机器人记忆',
          '',
          ...local.map((e) => `- [${e.id}] ${e.memory}${e.expires ? `（过期 ${e.expires}）` : ''}`),
        ].join('\n'),
      );
    }
    return parts.join('\n\n');
  }


  private skillDir(botId: string, slug: string): string {
    return path.join(this.botSkillsDir(botId), slug);
  }

  private skillFile(botId: string, slug: string): string {
    return path.join(this.skillDir(botId, slug), 'SKILL.md');
  }

  listSkills(botId: string): BotSkill[] {
    this.assertKnownBotId(botId);
    this.ensureBotLayout(botId);
    const root = this.botSkillsDir(botId);
    if (!fs.existsSync(root)) return [];
    const out: BotSkill[] = [];
    for (const name of fs.readdirSync(root)) {
      const file = this.skillFile(botId, name);
      if (!fs.existsSync(file) || !fs.statSync(path.join(root, name)).isDirectory()) continue;
      try {
        out.push(this.parseSkillMarkdown(name, fs.readFileSync(file, 'utf8')));
      } catch {
        /* skip bad skill */
      }
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /** `~/.agents/skills` — user-global Agent Skills (SKILL.md per subdir). */
  private globalAgentsSkillsDir(): string {
    return path.join(os.homedir(), '.agents', 'skills');
  }

  listGlobalAgentsSkills(): BotSkill[] {
    const root = this.globalAgentsSkillsDir();
    if (!fs.existsSync(root)) return [];
    const out: BotSkill[] = [];
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      const file = path.join(dir, 'SKILL.md');
      try {
        if (!fs.statSync(dir).isDirectory() || !fs.existsSync(file)) continue;
        out.push(this.parseSkillMarkdown(name, fs.readFileSync(file, 'utf8')));
      } catch {
        /* skip bad skill */
      }
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Resolve one enabled skill for this bot: local `skills/<slug>` first, then
   * an enabled global skill under `~/.agents/skills` when useGlobalSkills is on.
   */
  resolveEnabledSkill(
    botId: string,
    slug: string,
  ): (BotSkill & { source: 'local' | 'global' }) | null {
    const clean = slug.trim();
    if (!clean) return null;
    const local = this.listSkills(botId).find((s) => s.slug === clean);
    if (local) return { ...local, source: 'local' };
    try {
      const config = this.readBotConfig(botId);
      if (config.useGlobalSkills && config.enabledGlobalSkills.includes(clean)) {
        const global = this.listGlobalAgentsSkills().find((s) => s.slug === clean);
        if (global) return { ...global, source: 'global' };
      }
    } catch {
      /* missing bot.json — local only */
    }
    return null;
  }

  /**
   * Catalog-only skills for system prompt: name / slug / when-to-use.
   * Full SKILL.md body is loaded on demand via the `read_skill` tool.
   */
  formatSkillsForPrompt(botId: string): string {
    const local = this.listSkills(botId);
    let useGlobalSkills = false;
    let enabledGlobalSkills: string[] = [];
    let global: BotSkill[] = [];
    try {
      const config = this.readBotConfig(botId);
      useGlobalSkills = config.useGlobalSkills === true;
      enabledGlobalSkills = Array.isArray(config.enabledGlobalSkills)
        ? config.enabledGlobalSkills
        : [];
      if (useGlobalSkills) global = this.listGlobalAgentsSkills();
    } catch {
      /* missing bot.json — local only */
    }
    return formatSkillCatalog(
      buildSkillCatalogEntries({
        local,
        global,
        useGlobalSkills,
        enabledGlobalSkills,
      }),
    );
  }

  writeSkill(botId: string, skill: BotSkill): void {
    this.assertKnownBotId(botId);
    const slug = sanitizeSkillSlug(skill.slug);
    if (!slug) throw new Error('invalid skill slug');
    this.ensureBotLayout(botId);
    ensureDir(this.skillDir(botId, slug));
    const nm = stripThinkContent(skill.name).trim() || slug;
    const desc = stripThinkContent(skill.description).trim() || nm;
    const body = stripThinkContent(skill.body).trim();
    fs.writeFileSync(
      this.skillFile(botId, slug),
      formatSkillMarkdown({ slug, name: nm, description: desc, body }),
      'utf8',
    );
  }

  deleteSkill(botId: string, slug: string): void {
    this.assertKnownBotId(botId);
    const clean = sanitizeSkillSlug(slug);
    if (!clean) return;
    const root = path.resolve(this.botSkillsDir(botId));
    const dir = path.resolve(this.skillDir(botId, clean));
    const rel = path.relative(root, dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('invalid skill path');
    }
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  private parseSkillMarkdown(slug: string, raw: string): BotSkill {
    return parseSkillMarkdown(slug, raw);
  }



  getWindowBounds(): { x: number; y: number; width: number; height: number } | null {
    const raw = readJson<{ x?: number; y?: number; width?: number; height?: number } | null>(
      this.windowPath,
      null,
    );
    if (!raw) return null;
    const { x, y, width, height } = raw;
    if (
      ![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)) ||
      width! < 400 ||
      height! < 300
    ) {
      return null;
    }
    return { x: x!, y: y!, width: width!, height: height! };
  }

  saveWindowBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    writeJson(this.windowPath, {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  }

  getUsageStats(): UsageStats {
    return loadUsageStats(this.usagePath);
  }

  recordUsage(
    ownerId: string,
    usage: TokenUsage,
    opts?: { alsoOwnerIds?: string[]; skipLifetime?: boolean },
  ): UsageStats {
    return recordTokenUsage(this.usagePath, ownerId, usage, opts);
  }


  /** Owner data dir (`~/.okbot/<botId|squadId>`). */
  ownerDir(ownerId: string): string {
    return path.join(this.root, ownerId);
  }

  /** `~/.okbot/<botId|squadId>/resources` — generated images / media. */
  ownerResourcesDir(ownerId: string): string {
    const id = assertSafeOwnerSegment(ownerId);
    const dir = path.join(this.ownerDir(id), 'resources');
    ensureDir(dir);
    return dir;
  }

  /** Latest per-run tool/error trajectory for a bot or squad, if any. */
  getLastRunTrace(ownerId: string): RunTraceFile | null {
    const id = (ownerId || '').trim();
    if (!id) return null;
    return readLastRunTrace(this.ownerDir(id));
  }

  /** Consume a settings-load warning once (for bootstrap toast). */
  takeSettingsLoadWarning(): string | null {
    const w = this.settingsLoadWarning;
    this.settingsLoadWarning = null;
    return w;
  }

  getSettings(): AppSettings {
    const loaded = readJsonResult<AppSettings>(this.settingsPath, DEFAULT_SETTINGS);
    // Parse/IO failure: keep the broken file, backup a copy, return in-memory defaults.
    // Never migrate-write here — that used to wipe API keys when settings.json went bad.
    if (loaded.status === 'invalid') {
      if (!this.settingsCorruptHandled) {
        this.settingsCorruptHandled = true;
        const backup = backupFileAside(this.settingsPath, 'corrupt');
        const detail = backup
          ? `settings.json 无法解析（${loaded.error}）。已备份到 ${backup}，未覆盖原文件；请修复后重启，或在设置里重新填写 API Key。`
          : `settings.json 无法解析（${loaded.error}）。未能写入备份；未覆盖原文件。请检查数据目录后重启，或在设置里重新填写 API Key。`;
        console.error('[okbot]', detail);
        this.settingsLoadWarning = detail;
      }
      return {
        ...DEFAULT_SETTINGS,
        model: {
          ...DEFAULT_SETTINGS.model,
          providers: DEFAULT_SETTINGS.model.providers.map((p) => ({
            ...p,
            models: [...p.models],
          })),
        },
        tools: {
          run_shell: { ...DEFAULT_SETTINGS.tools.run_shell },
          read_file: { ...DEFAULT_SETTINGS.tools.read_file },
          read_skill: { ...DEFAULT_SETTINGS.tools.read_skill },
          write_file: { ...DEFAULT_SETTINGS.tools.write_file },
          edit_file: { ...DEFAULT_SETTINGS.tools.edit_file },
          generate_image: { ...DEFAULT_SETTINGS.tools.generate_image },
        },
        security: {
          ...DEFAULT_SETTINGS.security,
          deniedPathPrefixes: [...DEFAULT_SETTINGS.security.deniedPathPrefixes],
          allowedPathPrefixes: [...DEFAULT_SETTINGS.security.allowedPathPrefixes],
        },
        contextCompression: { ...DEFAULT_SETTINGS.contextCompression },
        maxTurns: DEFAULT_SETTINGS.maxTurns,
        instructions: { ...DEFAULT_SETTINGS.instructions },
        memory: { ...DEFAULT_SETTINGS.memory },
        squad: { ...DEFAULT_SETTINGS.squad },
        toolRun: { ...DEFAULT_SETTINGS.toolRun },
        localHttpApi: normalizeLocalHttpApiSettings(DEFAULT_SETTINGS.localHttpApi),
        computers: [],
        defaultComputerId: 'local',
        autoApprovalRules: [...DEFAULT_SETTINGS.autoApprovalRules],
      };
    }

    const raw = loaded.data;
    const language =
      raw.language === 'en' || raw.language === 'zh' || raw.language === 'system'
        ? raw.language
        : 'system';
    const next: AppSettings = {
      theme: raw.theme ?? 'system',
      language,
      microphoneId: typeof raw.microphoneId === 'string' ? raw.microphoneId : '',
      hardwareAcceleration: raw.hardwareAcceleration !== false,
      autoUpdate: raw.autoUpdate !== false,
      sidebarDockMagnify: raw.sidebarDockMagnify === true,
      developerMode: raw.developerMode === true,
      autoApprovalEnabled: raw.autoApprovalEnabled === true,
      autoApprovalRules: normalizeAutoApprovalRules(raw.autoApprovalRules),
      tools: normalizeToolPreferences((raw as { tools?: unknown }).tools),
      security: normalizeSecuritySettings((raw as { security?: unknown }).security),
      model: normalizeModelSettings(raw.model),
      contextCompression: normalizeContextCompression(
        (raw as { contextCompression?: unknown }).contextCompression,
      ),
      maxTurns: normalizeMaxTurns((raw as { maxTurns?: unknown }).maxTurns),
      instructions: normalizeInstructionsSettings((raw as { instructions?: unknown }).instructions),
      memory: normalizeMemorySettings((raw as { memory?: unknown }).memory),
      squad: normalizeSquadSettings((raw as { squad?: unknown }).squad),
      toolRun: normalizeToolRunSettings((raw as { toolRun?: unknown }).toolRun),
      localHttpApi: normalizeLocalHttpApiSettings((raw as { localHttpApi?: unknown }).localHttpApi),
      computers: normalizeComputers((raw as { computers?: unknown }).computers),
      defaultComputerId: normalizeDefaultComputerId(
        (raw as { defaultComputerId?: unknown }).defaultComputerId,
        normalizeComputers((raw as { computers?: unknown }).computers),
      ),
    };
    // Rewrite legacy shapes in place (no dual-read forever). Only when we actually
    // read a file from disk — never after parse failure.
    if (loaded.status === 'ok') {
      const rawModel = (raw as unknown as { model?: Record<string, unknown> }).model;
      // Flat single-provider (no `providers`) or older `{ model, contextWindow }`.
      const legacyModel =
        rawModel &&
        typeof rawModel === 'object' &&
        !Array.isArray(rawModel.providers);
      const legacySquadMissing = (raw as { squad?: unknown }).squad === undefined;
      const rawSquad = (raw as { squad?: { captainPersona?: unknown; playbook?: unknown } }).squad;
      const rawPersona =
        rawSquad && typeof rawSquad.captainPersona === 'string'
          ? rawSquad.captainPersona.trim()
          : '';
      const rawPlaybook =
        rawSquad && typeof rawSquad.playbook === 'string' ? rawSquad.playbook.trim() : '';
      const legacySquadSerial =
        rawPersona === LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA ||
        rawPlaybook === LEGACY_DEFAULT_SQUAD_PLAYBOOK;
      const rawLocal = (raw as { localHttpApi?: unknown }).localHttpApi;
      const legacyLocalHttpApi =
        rawLocal === undefined ||
        typeof rawLocal !== 'object' ||
        rawLocal === null ||
        typeof (rawLocal as { token?: unknown }).token !== 'string' ||
        !(rawLocal as { token: string }).token.trim();
      const rawInstructions = (raw as { instructions?: { agentsMdRefreshSystemPrompt?: unknown } })
        .instructions;
      const rawAgentsPrompt =
        rawInstructions && typeof rawInstructions.agentsMdRefreshSystemPrompt === 'string'
          ? rawInstructions.agentsMdRefreshSystemPrompt.trim()
          : '';
      const legacyAgentsRefreshPrompt =
        rawAgentsPrompt === LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT ||
        rawAgentsPrompt === LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD;
      if (
        legacyModel ||
        legacySquadMissing ||
        legacySquadSerial ||
        legacyLocalHttpApi ||
        legacyAgentsRefreshPrompt
      ) {
        backupFileAside(this.settingsPath, 'pre-migrate');
        this.writeSettingsFile(next);
      }
    }
    return next;
  }


  /** settings.json holds API tokens; keep it owner-readable only. */
  private writeSettingsFile(data: unknown): void {
    writeJson(this.settingsPath, data);
    try {
      fs.chmodSync(this.settingsPath, 0o600);
    } catch (err) {
      console.error('[okbot] chmod settings.json failed', err);
    }
  }

  saveSettings(settings: AppSettings): AppSettings {
    const language =
      settings.language === 'en' || settings.language === 'zh' || settings.language === 'system'
        ? settings.language
        : 'system';
    const next: AppSettings = {
      theme: settings.theme ?? 'system',
      language,
      microphoneId: typeof settings.microphoneId === 'string' ? settings.microphoneId : '',
      hardwareAcceleration: settings.hardwareAcceleration !== false,
      autoUpdate: settings.autoUpdate !== false,
      sidebarDockMagnify: settings.sidebarDockMagnify === true,
      developerMode: settings.developerMode === true,
      autoApprovalEnabled: settings.autoApprovalEnabled === true,
      autoApprovalRules: normalizeAutoApprovalRules(settings.autoApprovalRules),
      tools: normalizeToolPreferences(settings.tools),
      security: normalizeSecuritySettings(settings.security),
      model: (() => {
        const m = normalizeModelSettings(settings.model);
        return {
          providers: m.providers.map((p) => ({
            ...p,
            baseURL: p.baseURL.trim(),
            apiKey: p.apiKey,
            name: p.name.trim() || p.name,
            models: [...p.models],
          })),
          defaultProviderId: m.defaultProviderId,
          defaultModelId: m.defaultModelId,
        };
      })(),
      contextCompression: normalizeContextCompression(settings.contextCompression),
      maxTurns: normalizeMaxTurns(settings.maxTurns),
      instructions: normalizeInstructionsSettings(settings.instructions),
      memory: normalizeMemorySettings(settings.memory),
      squad: normalizeSquadSettings(settings.squad),
      toolRun: normalizeToolRunSettings(settings.toolRun),
      localHttpApi: normalizeLocalHttpApiSettings(settings.localHttpApi),
      computers: normalizeComputers(settings.computers),
      defaultComputerId: normalizeDefaultComputerId(
        settings.defaultComputerId,
        normalizeComputers(settings.computers),
      ),
    };
    this.writeSettingsFile(next);
    return next;
  }

  private botConfigPath(botId: string): string {
    return path.join(this.botDir(botId), 'bot.json');
  }

  private listRoster(): BotRosterEntry[] {
    const raw = readJson<BotRosterEntry[]>(this.botsPath, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e.id === 'string' && e.id)
      .map((e) => ({
        id: e.id,
        name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : '未命名助手',
        description: typeof e.description === 'string' ? e.description : '',
      }));
  }

  private writeRoster(entries: BotRosterEntry[]): void {
    writeJson(
      this.botsPath,
      entries.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
      })),
    );
  }

  private readBotConfig(botId: string): BotConfig {
    const file = this.botConfigPath(botId);
    if (!fs.existsSync(file)) {
      throw new Error(`缺少 bot.json: ${botId}`);
    }
    const raw = readJson<Partial<BotConfig> & Record<string, unknown>>(file, {});
    const avatarKind = normalizeBotAvatarKind(raw.avatarKind);
    const colorRaw = typeof raw.color === 'string' ? raw.color.trim() : '';
    // Empty / invalid → '' for both kinds (bot-avatar library default; emoji = no fill).
    const color = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : '';
    const rawModelId =
      typeof raw.modelId === 'string' && raw.modelId.trim() ? raw.modelId.trim() : undefined;
    const rawProviderId =
      typeof raw.providerId === 'string' && raw.providerId.trim()
        ? raw.providerId.trim()
        : undefined;
    // Legacy modelId-only → bind provider via current settings; rewrite disk when shape changes.
    const bound = resolveModelRef(this.getSettings().model, {
      providerId: rawProviderId,
      modelId: rawModelId,
    });
    const modelId = bound.modelId;
    const providerId = bound.providerId;
    const botAvatarType =
      avatarKind === 'bot-avatar' ? normalizeBotAvatarType(raw.botAvatarType) : undefined;
    const enabledGlobalSkills = Array.isArray(raw.enabledGlobalSkills)
      ? [...new Set(
          raw.enabledGlobalSkills
            .filter((s): s is string => typeof s === 'string')
            .map((s) => s.trim())
            .filter(Boolean),
        )]
      : [];
    const config: BotConfig = {
      id: botId,
      avatarKind,
      emoji: typeof raw.emoji === 'string' && raw.emoji.trim() ? raw.emoji.trim() : '🤖',
      color,
      ...(botAvatarType ? { botAvatarType } : {}),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      onboardingComplete: raw.onboardingComplete === true,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(raw.hasUnreadReply === true ? { hasUnreadReply: true as const } : {}),
      useGlobalSkills: raw.useGlobalSkills === true,
      enabledGlobalSkills,
    };
    const legacyOnlyModelId = Boolean(rawModelId) && !rawProviderId;
    const dropped =
      Boolean(rawModelId || rawProviderId) && !providerId && !modelId;
    // Only rewrite when the provider catalog is loaded. Transient empty providers
    // (corrupt/unreadable settings.json → in-memory defaults with providers:[])
    // must not wipe bot model bindings from disk.
    const providersOk = (this.getSettings().model.providers?.length ?? 0) > 0;
    if (legacyOnlyModelId && providerId && modelId) {
      // Successful legacy modelId-only → providerId migration.
      this.writeBotConfig(config);
    } else if (dropped && providersOk) {
      // Real mismatch against a loaded catalog: clear stale refs.
      this.writeBotConfig(config);
    }
    return config;
  }

  private writeBotConfig(config: BotConfig): void {
    ensureDir(this.botDir(config.id));
    const avatarKind = normalizeBotAvatarKind(config.avatarKind);
    const enabledGlobalSkills = Array.isArray(config.enabledGlobalSkills)
      ? [...new Set(
          config.enabledGlobalSkills
            .filter((s) => typeof s === 'string')
            .map((s) => s.trim())
            .filter(Boolean),
        )]
      : [];
    writeJson(this.botConfigPath(config.id), {
      id: config.id,
      avatarKind,
      emoji: config.emoji,
      color: config.color,
      ...(avatarKind === 'bot-avatar'
        ? { botAvatarType: normalizeBotAvatarType(config.botAvatarType) }
        : config.botAvatarType
          ? { botAvatarType: normalizeBotAvatarType(config.botAvatarType) }
          : {}),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      onboardingComplete: config.onboardingComplete === true,
      ...(config.providerId?.trim() ? { providerId: config.providerId.trim() } : {}),
      ...(config.modelId?.trim() ? { modelId: config.modelId.trim() } : {}),
      ...(config.hasUnreadReply === true ? { hasUnreadReply: true } : {}),
      useGlobalSkills: config.useGlobalSkills === true,
      enabledGlobalSkills,
    });
  }

  private mergeBot(entry: BotRosterEntry, config: BotConfig): Bot {
    const avatarKind = normalizeBotAvatarKind(config.avatarKind);
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      avatarKind,
      emoji: config.emoji,
      color: config.color,
      ...(avatarKind === 'bot-avatar'
        ? { botAvatarType: normalizeBotAvatarType(config.botAvatarType) }
        : config.botAvatarType
          ? { botAvatarType: normalizeBotAvatarType(config.botAvatarType) }
          : {}),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      onboardingComplete: config.onboardingComplete,
      ...(config.providerId?.trim() ? { providerId: config.providerId.trim() } : {}),
      ...(config.modelId?.trim() ? { modelId: config.modelId.trim() } : {}),
      ...(config.hasUnreadReply === true ? { hasUnreadReply: true as const } : {}),
      useGlobalSkills: config.useGlobalSkills === true,
      enabledGlobalSkills: Array.isArray(config.enabledGlobalSkills)
        ? [...config.enabledGlobalSkills]
        : [],
    };
  }

  listBots(): Bot[] {
    const roster = this.listRoster();
    const out: Bot[] = [];
    for (const entry of roster) {
      try {
        out.push(this.mergeBot(entry, this.readBotConfig(entry.id)));
      } catch (err) {
        console.error('[okbot] skip bot', entry.id, err);
      }
    }
    return out;
  }


  /** Roster ids + any leftover `bot_*` entries under the data root (dirs/files). */
  private collectKnownBotIds(): Set<string> {
    const ids = new Set<string>();
    for (const e of this.listRoster()) {
      if (e.id) ids.add(e.id);
    }
    try {
      for (const name of fs.readdirSync(this.root)) {
        if (name.startsWith('bot_')) ids.add(name);
      }
    } catch {
      /* ignore missing/unreadable root */
    }
    return ids;
  }

  /**
   * Allocate `bot_yyyyMMdd_<seq>` for a newly created bot.
   * Sequence is per local calendar day; skips ids already taken by roster or filesystem.
   */
  private allocateNewBotId(): string {
    const dateYmd = localDateYyyyMmDd();
    const known = this.collectKnownBotIds();
    let maxSeq = 0;
    for (const id of known) {
      const seq = parseBotIdSeqForDate(id, dateYmd);
      if (seq != null && seq > maxSeq) maxSeq = seq;
    }
    let seq = maxSeq + 1;
    for (;;) {
      const id = formatBotId(dateYmd, seq);
      if (!known.has(id) && !fs.existsSync(this.botDir(id))) return id;
      seq += 1;
    }
  }

  createBot(input: {
    name: string;
    description?: string;
    emoji?: string;
    color?: string;
    providerId?: string;
    modelId?: string;
    avatarKind?: BotAvatarKind;
    botAvatarType?: BotAvatarShape;
  }): Bot {
    const now = new Date().toISOString();
    const id = this.allocateNewBotId();
    const avatarKind = normalizeBotAvatarKind(input.avatarKind);
    const colorRaw = typeof input.color === 'string' ? input.color.trim() : '';
    const color = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : '';
    const entry: BotRosterEntry = {
      id,
      name: input.name.trim() || '未命名助手',
      description: (input.description ?? '').trim(),
    };
    const config: BotConfig = {
      id,
      avatarKind,
      emoji: input.emoji?.trim() || '🤖',
      color,
      ...(avatarKind === 'bot-avatar'
        ? { botAvatarType: normalizeBotAvatarType(input.botAvatarType) }
        : {}),
      createdAt: now,
      updatedAt: now,
      onboardingComplete: false,
      ...(() => {
        const bound = resolveModelRef(this.getSettings().model, {
          providerId: input.providerId,
          modelId: input.modelId,
        });
        return {
          ...(bound.providerId ? { providerId: bound.providerId } : {}),
          ...(bound.modelId ? { modelId: bound.modelId } : {}),
        };
      })(),
      useGlobalSkills: false,
      enabledGlobalSkills: [],
    };
    // Layout + bot.json first so a crash never leaves a roster ghost without config.
    this.ensureBotLayout(id);
    this.writeBotConfig(config);
    fs.writeFileSync(this.sessionFile(id), '', 'utf8');
    const roster = this.listRoster();
    roster.unshift(entry);
    this.writeRoster(roster);
    const bot = this.mergeBot(entry, config);
    this.noteSessionsChanged(id, 'created');
    return bot;
  }

  updateBot(
    id: string,
    patch: Partial<
      Pick<
        Bot,
        | 'name'
        | 'description'
        | 'emoji'
        | 'color'
        | 'providerId'
        | 'modelId'
        | 'avatarKind'
        | 'botAvatarType'
        | 'useGlobalSkills'
        | 'enabledGlobalSkills'
      >
    >,
  ): Bot {
    const roster = this.listRoster();
    const idx = roster.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error('助手不存在');
    const entry = { ...roster[idx] };
    const config = this.readBotConfig(id);
    const profileChanged =
      patch.name !== undefined || patch.description !== undefined;
    if (patch.name !== undefined) entry.name = patch.name.trim() || entry.name;
    if (patch.description !== undefined) entry.description = patch.description.trim();
    if (patch.emoji !== undefined) config.emoji = patch.emoji.trim() || config.emoji;
    if (patch.avatarKind !== undefined) {
      config.avatarKind = normalizeBotAvatarKind(patch.avatarKind);
    }
    if (patch.botAvatarType !== undefined) {
      config.botAvatarType = normalizeBotAvatarType(patch.botAvatarType);
    }
    if (patch.color !== undefined) {
      const c = patch.color.trim();
      // Hex accent, or '' for 「默认」(bot-avatar library palette / emoji no fill).
      config.color = /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '';
    }
    if (normalizeBotAvatarKind(config.avatarKind) === 'bot-avatar' && !config.botAvatarType) {
      config.botAvatarType = 'clover';
    }
    if (patch.providerId !== undefined || patch.modelId !== undefined) {
      const nextPid =
        patch.providerId !== undefined ? patch.providerId.trim() : (config.providerId || '').trim();
      const nextMid =
        patch.modelId !== undefined ? patch.modelId.trim() : (config.modelId || '').trim();
      if (!nextPid && !nextMid) {
        delete config.providerId;
        delete config.modelId;
      } else {
        const bound = resolveModelRef(this.getSettings().model, {
          providerId: nextPid,
          modelId: nextMid,
        });
        if (bound.providerId && bound.modelId) {
          config.providerId = bound.providerId;
          config.modelId = bound.modelId;
        } else {
          delete config.providerId;
          delete config.modelId;
        }
      }
    }
    if (patch.useGlobalSkills !== undefined) {
      config.useGlobalSkills = patch.useGlobalSkills === true;
    }
    if (patch.enabledGlobalSkills !== undefined) {
      config.enabledGlobalSkills = [
        ...new Set(
          (Array.isArray(patch.enabledGlobalSkills) ? patch.enabledGlobalSkills : [])
            .filter((s): s is string => typeof s === 'string')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
    }
    config.updatedAt = new Date().toISOString();
    roster[idx] = entry;
    this.writeRoster(roster);
    this.writeBotConfig(config);
    if (profileChanged) {
      this.syncAgentsMdProfile(id, entry.name, entry.description);
    }
    const bot = this.mergeBot(entry, config);
    this.noteSessionsChanged(id, 'updated');
    return bot;
  }

  deleteBot(id: string): void {
    const safe = assertSafeOwnerSegment(id);
    this.assertKnownBotId(safe);
    const roster = this.listRoster().filter((b) => b.id !== safe);
    this.writeRoster(roster);
    const dir = this.botDir(safe);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    this.purgeBotFromSquads(safe);
    try {
      removeOwnerUsage(this.usagePath, safe);
    } catch (err) {
      console.error('[okbot] removeOwnerUsage failed', safe, err);
    }
    this.noteSessionsChanged(safe, 'deleted');
  }



  /** Keep AGENTS.md identity lines in sync with roster name/description. */
  private syncAgentsMdProfile(botId: string, name: string, description: string): void {
    this.ensureBotLayout(botId);
    const prev = this.readAgentsMd(botId);
    const duty = prev
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('当前主要职责：'));
    const role = [
      '# 角色与目标',
      '',
      `你是「${name}」，用户的本机个人助手。`,
      description.trim()
        ? `对外简介：${description.trim()}。`
        : '请用专业、可靠的方式协助用户完成任务。',
      duty ?? null,
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');

    const stripped = prev.replace(/^# 角色与目标\s*\n[\s\S]*?(?=^# |\Z)/m, '').replace(/^\s+/, '');
    this.writeAgentsMd(botId, `${role}${stripped}`);
  }

  finishBotOnboarding(botId: string, answers: BotOnboardingAnswers = {}): Bot {
    const roster = this.listRoster();
    const entry = roster.find((b) => b.id === botId);
    if (!entry) throw new Error('助手不存在');
    const config = this.readBotConfig(botId);
    const name = entry.name;
    const description = entry.description.trim();
    const scenario = (answers.scenarioLabel || '').trim();
    const how = (answers.howLabel || '').trim();
    const md = [
      '# 角色与目标',
      '',
      `你是「${name}」，用户的本机个人助手。`,
      description
        ? `对外简介：${description}。`
        : '请用专业、可靠的方式协助用户完成任务。',
      scenario ? `当前主要职责：${scenario}。` : null,
      '',
      '# 用户偏好',
      '',
      how ? `- 协作方式：${how}` : '- （随对话自动补充）',
      '- 回答简洁清楚；不确定时先说明假设再行动',
      '- 涉及破坏性操作（删除、覆盖、推送、安装）前先征得同意',
      '',
      '# 项目与环境',
      '',
      '- （随对话自动补充仓库路径、技术栈与常用命令）',
      '',
      '# 工作备注',
      '',
      answers.scenarioId ? `- 场景标签：${answers.scenarioId}` : null,
      answers.howId ? `- 风格标签：${answers.howId}` : null,
      '- 本文件由系统根据对话持续维护；也可在助手「高级」中手动编辑',
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');
    this.writeAgentsMd(botId, md);
    config.onboardingComplete = true;
    config.updatedAt = new Date().toISOString();
    this.writeBotConfig(config);
    const bot = this.mergeBot(entry, config);
    this.noteSessionsChanged(botId, 'updated');
    return bot;
  }



  listSquads(): Squad[] {
    const raw = readJson<unknown[]>(this.squadsPath, []);
    if (!Array.isArray(raw)) return [];
    const modelSettings = this.getSettings().model;
    const out: Squad[] = [];
    let dirty = false;
    for (const item of raw) {
      const s = normalizeSquad(item);
      if (!s) {
        dirty = true;
        continue;
      }
      if (item && typeof item === 'object') {
        const src = item as Record<string, unknown>;
        if ('leaderBotId' in src || 'captainBotId' in src || 'guidance' in src) dirty = true;
      }
      const rawPid = (s.providerId || '').trim();
      const rawMid = (s.modelId || '').trim();
      // Skip resolve/clear when providers are empty (corrupt settings defaults) —
      // otherwise every squad binding would be wiped on listSquads().
      if ((rawPid || rawMid) && (modelSettings.providers?.length ?? 0) > 0) {
        const bound = resolveModelRef(modelSettings, {
          providerId: rawPid || undefined,
          modelId: rawMid || undefined,
        });
        const nextPid = bound.providerId;
        const nextMid = bound.modelId;
        if (nextPid !== s.providerId || nextMid !== s.modelId) {
          dirty = true;
        }
        if (nextPid) s.providerId = nextPid;
        else delete s.providerId;
        if (nextMid) s.modelId = nextMid;
        else delete s.modelId;
      }
      out.push(s);
    }
    if (dirty) writeJson(this.squadsPath, out);
    return out;
  }

  private collectKnownSquadIds(): Set<string> {
    const ids = new Set<string>();
    for (const s of this.listSquads()) {
      if (s.id) ids.add(s.id);
    }
    try {
      for (const name of fs.readdirSync(this.root)) {
        if (name.startsWith('squad_')) ids.add(name);
      }
    } catch {
      /* ignore */
    }
    return ids;
  }

  private allocateNewSquadId(): string {
    const dateYmd = localDateYyyyMmDd();
    const known = this.collectKnownSquadIds();
    let maxSeq = 0;
    for (const id of known) {
      const seq = parseSquadIdSeqForDate(id, dateYmd);
      if (seq != null && seq > maxSeq) maxSeq = seq;
    }
    let seq = maxSeq + 1;
    for (;;) {
      const id = formatSquadId(dateYmd, seq);
      if (!known.has(id) && !fs.existsSync(this.squadDir(id))) return id;
      seq += 1;
    }
  }

  private normalizeSquadMembers(members: SquadMember[]): SquadMember[] {
    const seen = new Set<string>();
    const out: SquadMember[] = [];
    for (const m of members) {
      const botId = (m?.botId || '').trim();
      if (!botId || seen.has(botId)) continue;
      seen.add(botId);
      out.push({ botId, role: (m.role || '').trim() || '成员' });
    }
    return out;
  }

  createSquad(input: CreateSquadInput): Squad {
    const name = (input.name || '').trim() || '未命名小队';
    const bots = this.listBots();
    const botIds = new Set(bots.map((b) => b.id));
    const members = this.normalizeSquadMembers(input.members || []);
    if (members.length < 2) throw new Error('小队至少需要 2 名队员');
    for (const m of members) {
      if (!botIds.has(m.botId)) throw new Error(`成员不存在：${m.botId}`);
    }
    const bound = resolveModelRef(this.getSettings().model, {
      providerId: input.providerId,
      modelId: input.modelId,
    });
    const now = new Date().toISOString();
    const squad: Squad = {
      id: this.allocateNewSquadId(),
      name,
      description: (input.description || '').trim(),
      members,
      createdAt: now,
      updatedAt: now,
    };
    if (bound.providerId) squad.providerId = bound.providerId;
    if (bound.modelId) squad.modelId = bound.modelId;
    const list = this.listSquads();
    list.unshift(squad);
    writeJson(this.squadsPath, list);
    this.ensureSquadLayout(squad.id);
    this.noteSessionsChanged(squad.id, 'created');
    return squad;
  }

  updateSquad(
    id: string,
    patch: Partial<Pick<Squad, 'name' | 'description' | 'members' | 'providerId' | 'modelId'>>,
  ): Squad {
    const list = this.listSquads();
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('小队不存在');
    const prev = list[idx]!;
    const bots = this.listBots();
    const botIds = new Set(bots.map((b) => b.id));
    const members = this.normalizeSquadMembers(patch.members ?? prev.members);
    if (members.length < 2) throw new Error('小队至少需要 2 名队员');
    for (const m of members) {
      if (!botIds.has(m.botId)) throw new Error(`成员不存在：${m.botId}`);
    }
    const next: Squad = {
      id: prev.id,
      name: patch.name !== undefined ? patch.name.trim() || prev.name : prev.name,
      description:
        patch.description !== undefined ? patch.description.trim() : prev.description,
      members,
      createdAt: prev.createdAt,
      updatedAt: new Date().toISOString(),
    };
    if (patch.providerId !== undefined || patch.modelId !== undefined) {
      const nextPid =
        patch.providerId !== undefined ? patch.providerId.trim() : (prev.providerId || '').trim();
      const nextMid =
        patch.modelId !== undefined ? patch.modelId.trim() : (prev.modelId || '').trim();
      // Align with updateBot: empty string clears override (use global default).
      if (!nextPid && !nextMid) {
        // leave providerId/modelId unset on `next`
      } else {
        const bound = resolveModelRef(this.getSettings().model, {
          providerId: nextPid,
          modelId: nextMid,
        });
        if (bound.providerId && bound.modelId) {
          next.providerId = bound.providerId;
          next.modelId = bound.modelId;
        }
        // unresolved → clear (same as updateBot)
      }
    } else {
      if (prev.providerId) next.providerId = prev.providerId;
      if (prev.modelId) next.modelId = prev.modelId;
    }
    if (prev.hasUnreadReply === true) next.hasUnreadReply = true;
    list[idx] = next;
    writeJson(this.squadsPath, list);
    this.noteSessionsChanged(id, 'updated');
    return next;
  }

  deleteSquad(id: string): void {
    const safe = assertSafeOwnerSegment(id);
    if (!isSquadOwnerId(safe) || !this.listSquads().some((s) => s.id === safe)) {
      throw new Error(`小队不存在：${safe}`);
    }
    writeJson(
      this.squadsPath,
      this.listSquads().filter((s) => s.id !== safe),
    );
    const dir = this.squadDir(safe);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    try {
      removeOwnerUsage(this.usagePath, safe);
    } catch (err) {
      console.error('[okbot] removeOwnerUsage failed', safe, err);
    }
    this.noteSessionsChanged(safe, 'deleted');
  }

  /** Drop a deleted bot from all squads; delete squads that fall below 2 members. */
  private purgeBotFromSquads(botId: string): void {
    const kept: Squad[] = [];
    for (const s of this.listSquads()) {
      const members = s.members.filter((m) => m.botId !== botId);
      if (members.length < 2) {
        const dir = this.squadDir(s.id);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        continue;
      }
      const next: Squad = { ...s, members, updatedAt: new Date().toISOString() };
      kept.push(next);
    }
    writeJson(this.squadsPath, kept);
  }

  /** One-time upgrade: rewrite legacy ChatMessage jsonl → v2 envelopes. */
  private ensureSessionV2(botId: string): void {
    const file = this.sessionFile(botId);
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return;
    const lines = raw.split('\n').filter(Boolean);
    let needsUpgrade = false;
    const records: SessionRecordV2[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isSessionRecordV2(parsed)) needsUpgrade = true;
        const rec = parseSessionLine(line);
        if (rec) records.push(rec);
      } catch {
        needsUpgrade = true;
      }
    }
    if (needsUpgrade) writeSessionRecordsAtomic(file, records);
  }

  private readSessionRecords(botId: string): SessionRecordV2[] {
    this.ensureBotLayout(botId);
    this.ensureSessionV2(botId);
    const file = this.sessionFile(botId);
    if (!fs.existsSync(file)) return [];
    const out: SessionRecordV2[] = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const rec = parseSessionLine(line);
      if (rec) out.push(rec);
    }
    return out;
  }

  private writeSessionRecords(botId: string, records: SessionRecordV2[]): void {
    this.ensureBotLayout(botId);
    writeSessionRecordsAtomic(this.sessionFile(botId), records);
  }

  /** Full chronological AgentInputItem list (no Summary+Buffer filter). */
  readSessionItems(botId: string, limit?: number): Record<string, unknown>[] {
    return this.readSessionItemsAfter(botId, null, limit);
  }

  /** SDK Session.addItems — append items as v2 envelopes. */
  appendSessionItems(
    botId: string,
    items: Record<string, unknown>[],
    meta?: SessionRecordV2['meta'],
  ): void {
    if (!items.length) return;
    this.ensureBotLayout(botId);
    this.ensureSessionV2(botId);
    const file = this.sessionFile(botId);
    const chunks: string[] = [];
    for (const item of items) {
      const role = typeof item.role === 'string' ? item.role : undefined;
      const uiRole = role === 'user' || role === 'assistant' ? role : meta?.uiRole;
      const rec: SessionRecordV2 = {
        v: 2,
        id: createId('evt'),
        createdAt: new Date().toISOString(),
        item,
        meta: {
          ...(uiRole ? { uiRole } : {}),
        },
      };
      chunks.push(`${JSON.stringify(rec)}\n`);
    }
    fs.appendFileSync(file, chunks.join(''), 'utf8');
  }

  popSessionItem(botId: string): Record<string, unknown> | undefined {
    const records = this.readSessionRecords(botId);
    if (!records.length) return undefined;
    const last = records[records.length - 1]!;
    this.writeSessionRecords(botId, records.slice(0, -1));
    return last.item;
  }

  clearSessionItems(botId: string): void {
    this.ensureBotLayout(botId);
    fs.writeFileSync(this.sessionFile(botId), '', 'utf8');
  }

  /** Full rewrite used by Session.replaceHistoryWithCompaction. Does not trim for Summary+Buffer. */
  replaceSessionItems(botId: string, items: Record<string, unknown>[]): void {
    // Preserve squad exchange bubbles — SDK compaction must not wipe UI transcript rows.
    const preserved = this.readSessionRecords(botId).filter(
      (r) => typeof r.meta?.speakerBotId === 'string' && !!r.meta.speakerBotId.trim(),
    );
    const records: SessionRecordV2[] = items.map((item) => {
      const role = typeof item.role === 'string' ? item.role : undefined;
      const uiRole = role === 'user' || role === 'assistant' ? role : undefined;
      return {
        v: 2,
        id: createId('evt'),
        createdAt: new Date().toISOString(),
        item,
        meta: uiRole ? { uiRole } : undefined,
      };
    });
    if (!preserved.length) {
      this.writeSessionRecords(botId, records);
      return;
    }
    const used = new Set(records.map((r) => r.id));
    const merged = [...records];
    for (const row of preserved) {
      if (used.has(row.id)) continue;
      merged.push(row);
      used.add(row.id);
    }
    merged.sort((a, b) => {
      const t = a.createdAt.localeCompare(b.createdAt);
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });
    this.writeSessionRecords(botId, merged);
  }

  /**
   * SDK/model view of session items: optionally skip everything through `afterMessageId`
   * (Summary+Buffer `coveredThroughId`). Appends still go to the full jsonl; only reads
   * for the model are filtered. If the marker id is missing (legacy trimmed file), the
   * remaining file is treated as the live buffer (start at 0).
   */
  readSessionItemsAfter(
    botId: string,
    afterMessageId?: string | null,
    limit?: number,
  ): Record<string, unknown>[] {
    const records = this.readSessionRecords(botId);
    let start = 0;
    if (afterMessageId) {
      const idx = records.findIndex((r) => r.id === afterMessageId);
      if (idx >= 0) start = idx + 1;
    }
    const items = records.slice(start).map((r) => r.item);
    if (limit == null || limit <= 0 || limit >= items.length) return items;
    return items.slice(items.length - limit);
  }

  /**
   * Adapter for OkbotFileSession (packages/agent).
   * Pass `afterMessageId` (= SessionSummary.coveredThroughId) so getItems returns only
   * the yet-uncompressed tail; writes always target the full session.jsonl.
   */
  createSessionStore(
    botId: string,
    opts?: { afterMessageId?: string | null },
  ): {
    getSessionId: () => string;
    readItems: (limit?: number) => Record<string, unknown>[];
    appendItems: (items: Record<string, unknown>[]) => void;
    popItem: () => Record<string, unknown> | undefined;
    clearItems: () => void;
    replaceItems: (items: Record<string, unknown>[]) => void;
  } {
    this.ensureSessionV2(botId);
    const afterMessageId = opts?.afterMessageId ?? null;
    return {
      getSessionId: () => botId,
      readItems: (limit?: number) => this.readSessionItemsAfter(botId, afterMessageId, limit),
      appendItems: (items: Record<string, unknown>[]) => this.appendSessionItems(botId, items),
      popItem: () => this.popSessionItem(botId),
      clearItems: () => this.clearSessionItems(botId),
      replaceItems: (items: Record<string, unknown>[]) => this.replaceSessionItems(botId, items),
    };
  }

  /**
   * Squad UI transcript is only user rows + assistant rows tagged with speakerBotId.
   * Runner/SDK assistant fragments without speakerBotId stay in jsonl for the model
   * but must not appear as chat bubbles (they reorder after exchange append).
   */
  private toSquadUiMessages(botId: string, messages: ChatMessage[]): ChatMessage[] {
    if (!isSquadOwnerId(botId)) return messages;
    return messages.filter(
      (m) => m.role === 'user' || (m.role === 'assistant' && !!m.speakerBotId?.trim()),
    );
  }

  getMessages(botId: string): ChatMessage[] {
    const all = this.readSessionRecords(botId)
      .map(recordToUiMessage)
      .filter((m): m is ChatMessage => m != null);
    return this.toSquadUiMessages(botId, all);
  }

  /**
   * Page through a bot session without reading the whole jsonl when it is large.
   * Omit beforeMessageId (or pass null) for the newest page.
   * Returns UI-projected bubbles only (tool-only rows are skipped).
   */
  getMessagesPage(
    botId: string,
    opts?: { limit?: number; beforeMessageId?: string | null },
  ): MessagesPage {
    this.ensureSessionV2(botId);
    const file = this.sessionFile(botId);
    const limit = opts?.limit ?? MESSAGE_PAGE_SIZE;
    if (!isSquadOwnerId(botId)) {
      return readJsonlPage(file, limit, opts?.beforeMessageId);
    }
    // Over-fetch raw rows so filtering SDK plumbing still fills a UI page.
    // Return all filtered rows from this window (may exceed `limit` slightly) so
    // nextBeforeMessageId stays aligned with the raw page cursor.
    const fetchLimit = Math.min(Math.max(limit * 5, limit), 250);
    const page = readJsonlPage(file, fetchLimit, opts?.beforeMessageId);
    return {
      messages: this.toSquadUiMessages(botId, page.messages),
      hasMore: page.hasMore,
      nextBeforeMessageId: page.nextBeforeMessageId,
    };
  }

  /**
   * Search UI chat bubbles across private bot sessions only (case-insensitive substring).
   * Intentionally does not scan squad transcripts (squad_* session.jsonl / listSquads).
   * Squads remain findable by name/description in the renderer session search.
   * Scans newest bots first; stops after limit hits. Empty query → [].
   */
  searchMessages(query: string, opts?: { limit?: number }): MessageSearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 40));
    const hits: MessageSearchHit[] = [];
    const bots = this.listBots();
    for (const bot of bots) {
      if (hits.length >= limit) break;
      // Defensive: never index squad owner session files as message hits.
      if (isSquadOwnerId(bot.id)) continue;
      const records = this.readSessionRecords(bot.id);
      // Newest first
      for (let i = records.length - 1; i >= 0; i--) {
        if (hits.length >= limit) break;
        const msg = recordToUiMessage(records[i]!);
        if (!msg) continue;
        const plain = plainTextFromMarkdown(msg.content || '');
        const hay = plain.toLowerCase();
        const idx = hay.indexOf(q);
        if (idx < 0) continue;
        const radius = 48;
        const start = Math.max(0, idx - radius);
        const end = Math.min(plain.length, idx + q.length + radius);
        let snippet = plain.slice(start, end).replace(/\s+/g, ' ').trim();
        if (start > 0) snippet = '…' + snippet;
        if (end < plain.length) snippet = snippet + '…';
        const avatarKind = normalizeBotAvatarKind(bot.avatarKind);
        hits.push({
          botId: bot.id,
          botName: bot.name,
          botEmoji: bot.emoji,
          botColor: bot.color,
          botAvatarKind: avatarKind,
          ...(avatarKind === 'bot-avatar'
            ? { botAvatarType: normalizeBotAvatarType(bot.botAvatarType) }
            : {}),
          message: msg,
          snippet,
        });
      }
    }
    return hits;
  }


  /** Newest assistant message text for sidebar subtitle; empty if none. */
  getLastReplyPreview(ownerId: string): string {
    const page = this.getMessagesPage(ownerId, { limit: 30 });
    for (let i = page.messages.length - 1; i >= 0; i--) {
      const m = page.messages[i]!;
      if (m.role !== 'assistant') continue;
      const text = plainTextFromMarkdown(m.content || '');
      if (text) return text;
    }
    return '';
  }

  withReplyPreviews<T extends { id: string }>(owners: T[]): Array<T & { lastReplyPreview?: string }> {
    return owners.map((owner) => ({
      ...owner,
      lastReplyPreview: this.getLastReplyPreview(owner.id),
    }));
  }

  touchSquad(id: string): Squad {
    const list = this.listSquads();
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('小队不存在');
    const cur = list[idx]!;
    const next: Squad = { ...cur, updatedAt: new Date().toISOString() };
    list.splice(idx, 1);
    list.unshift(next);
    writeJson(this.squadsPath, list);
    return next;
  }

  /** Bump bot to top of recents after a chat message. */
  touchBot(id: string): Bot {
    const roster = this.listRoster();
    const idx = roster.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error('助手不存在');
    const entry = roster[idx]!;
    const config = this.readBotConfig(id);
    config.updatedAt = new Date().toISOString();
    roster.splice(idx, 1);
    roster.unshift(entry);
    this.writeRoster(roster);
    this.writeBotConfig(config);
    return this.mergeBot(entry, config);
  }

  /** Persist unread flag for a bot or squad chat owner. */
  setHasUnreadReply(ownerId: string, hasUnread: boolean): void {
    if (isSquadOwnerId(ownerId)) {
      const list = this.listSquads();
      const idx = list.findIndex((s) => s.id === ownerId);
      if (idx < 0) return;
      const cur = list[idx]!;
      const nextFlag = hasUnread === true;
      if ((cur.hasUnreadReply === true) === nextFlag) return;
      const next: Squad = { ...cur };
      if (nextFlag) next.hasUnreadReply = true;
      else delete next.hasUnreadReply;
      list[idx] = next;
      writeJson(this.squadsPath, list);
      return;
    }
    try {
      const config = this.readBotConfig(ownerId);
      const nextFlag = hasUnread === true;
      if ((config.hasUnreadReply === true) === nextFlag) return;
      if (nextFlag) config.hasUnreadReply = true;
      else delete config.hasUnreadReply;
      this.writeBotConfig(config);
    } catch (err) {
      console.error('[okbot] setHasUnreadReply failed', ownerId, err);
    }
  }

  /** Lookup one UI message by id (scans session records). */
  getMessageById(ownerId: string, messageId: string): ChatMessage | null {
    const id = (messageId || '').trim();
    if (!id) return null;
    for (const rec of this.readSessionRecords(ownerId)) {
      if (rec.id !== id) continue;
      return recordToUiMessage(rec);
    }
    return null;
  }

  /**
   * Session items chronological through and including the envelope whose id
   * equals `messageId` (typically a user bubble id).
   * When `afterMessageId` is set (Summary+Buffer coveredThroughId), only the
   * yet-uncompressed tail after that marker is returned — same projection the
   * model sees (summary lives in instructions, not as session items).
   */
  getSessionItemsThroughMessage(
    botId: string,
    messageId: string,
    opts?: { afterMessageId?: string | null },
  ): { items: Record<string, unknown>[]; found: boolean } {
    const records = this.readSessionRecords(botId);
    const idx = records.findIndex((r) => r.id === messageId);
    if (idx < 0) return { items: [], found: false };
    let start = 0;
    const afterId = opts?.afterMessageId;
    if (afterId) {
      const markerIdx = records.findIndex((r) => r.id === afterId);
      if (markerIdx >= 0) start = markerIdx + 1;
    }
    if (start > idx) {
      // Target bubble sits inside the already-summarized span.
      return { items: [], found: true };
    }
    return {
      items: records.slice(start, idx + 1).map((r) => r.item),
      found: true,
    };
  }

  /** Patch fields on an existing UI message (matched by envelope id). */
  patchMessage(botId: string, messageId: string, patch: Partial<ChatMessage>): ChatMessage | null {
    const records = this.readSessionRecords(botId);
    const idx = records.findIndex((r) => r.id === messageId);
    if (idx < 0) return null;
    const prev = records[idx]!;
    const prevUi = recordToUiMessage(prev);
    if (!prevUi) return null;
    const nextMsg: ChatMessage = {
      ...prevUi,
      ...patch,
      id: prevUi.id,
      role: prevUi.role,
    };
    // Always merge onto the existing SDK item so Responses array content survives.
    const nextRec = mergeUiMessageOntoRecord(prev, nextMsg);
    if (patch.content === undefined && prev.item) {
      nextRec.item = prev.item;
    }
    records[idx] = nextRec;
    this.writeSessionRecords(botId, records);
    return nextMsg;
  }

  appendMessage(botId: string, message: ChatMessage): void {
    this.ensureBotLayout(botId);
    this.ensureSessionV2(botId);
    const rec = legacyMessageToRecord(message);
    fs.appendFileSync(this.sessionFile(botId), `${JSON.stringify(rec)}\n`, 'utf8');
    this.noteSessionsChanged(botId, 'message');
  }

  /**
   * Finalize assistant bubble content.
   * Prefer updating the last assistant row (possibly just written by Runner.addItems)
   * so we do not double-append the same reply.
   * Error paths must pass `{ allowRebind: false }` so a fresh "错误：…" row never
   * rebind-scans onto the previous assistant turn.
   */
  upsertAssistantMessage(
    botId: string,
    message: ChatMessage,
    opts?: { allowRebind?: boolean },
  ): void {
    const allowRebind = opts?.allowRebind !== false;
    const records = this.readSessionRecords(botId);
    const byId = records.findIndex((r) => r.id === message.id);
    if (byId >= 0) {
      records[byId] = mergeUiMessageOntoRecord(records[byId]!, message);
      this.writeSessionRecords(botId, records);
      this.noteSessionsChanged(botId, 'message');
      return;
    }
    // Abort during tool approval clears streamed content then still called upsert
    // with an empty ephemeral assistant id. Rebinding would replace the previous
    // turn's assistant row — refuse empty orphan upserts (no id match).
    if (!(message.content || '').trim()) {
      return;
    }
    // Squad UI transcript rows always carry speakerBotId. Never rebind an SDK
    // history assistant onto them — that corrupts model session items and can
    // park the captain bubble after exchange rows.
    // Error paths also skip rebind-scan (append a new row instead).
    if (
      !allowRebind ||
      (typeof message.speakerBotId === 'string' && message.speakerBotId.trim())
    ) {
      records.push(legacyMessageToRecord(message));
      this.writeSessionRecords(botId, records);
      this.noteSessionsChanged(botId, 'message');
      return;
    }
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i]!;
      // Never clobber squad ask/reply bubbles (they carry speakerBotId).
      if (typeof rec.meta?.speakerBotId === 'string' && rec.meta.speakerBotId.trim()) {
        continue;
      }
      const ui = recordToUiMessage(rec);
      if (ui?.role === 'assistant') {
        // Rebind Runner-persisted row to the streaming UI id and final text,
        // keeping Responses array-shaped content (do not flatten via legacyMessageToRecord).
        records[i] = mergeUiMessageOntoRecord(rec, message);
        this.writeSessionRecords(botId, records);
        this.noteSessionsChanged(botId, 'message');
        return;
      }
    }
    records.push(legacyMessageToRecord(message));
    this.writeSessionRecords(botId, records);
    this.noteSessionsChanged(botId, 'message');
  }

  private isPendingHitlRecord(raw: unknown): raw is PendingHitlRecord {
    if (!raw || typeof raw !== 'object') return false;
    const o = raw as Record<string, unknown>;
    return (
      o.v === 1 &&
      typeof o.requestId === 'string' &&
      typeof o.messageId === 'string' &&
      typeof o.toolName === 'string' &&
      typeof o.serializedRunState === 'string' &&
      typeof o.createdAt === 'string'
    );
  }

  savePendingHitl(botId: string, data: PendingHitlRecord): void {
    this.ensureBotLayout(botId);
    const record: PendingHitlRecord = {
      v: 1,
      requestId: data.requestId,
      messageId: data.messageId,
      toolName: data.toolName,
      arguments: data.arguments,
      serializedRunState: data.serializedRunState,
      createdAt: data.createdAt || new Date().toISOString(),
      ...(typeof data.computerId === 'string' && data.computerId.trim()
        ? { computerId: data.computerId.trim() }
        : {}),
      ...(typeof data.userText === 'string' && data.userText
        ? { userText: data.userText }
        : {}),
    };
    writeJson(this.pendingHitlFile(botId), record);
  }

  loadPendingHitl(botId: string): PendingHitlRecord | null {
    const file = this.pendingHitlFile(botId);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (this.isPendingHitlRecord(raw)) return raw;
      // Allow a one-element array for forward compatibility.
      if (Array.isArray(raw) && raw.length && this.isPendingHitlRecord(raw[0])) {
        return raw[0];
      }
      return null;
    } catch {
      return null;
    }
  }

  clearPendingHitl(botId: string): void {
    const file = this.pendingHitlFile(botId);
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * On app startup: any last-run-trace still marked `running` was interrupted by crash/quit.
   * Mark them aborted so UI does not show a stuck "running" trajectory.
   */
  abandonRunningTracesOnStartup(): number {
    let n = 0;
    for (const b of this.listRoster()) {
      if (markAbandonedIfRunning(this.ownerDir(b.id))) n += 1;
    }
    for (const s of this.listSquads()) {
      if (markAbandonedIfRunning(this.ownerDir(s.id))) n += 1;
    }
    return n;
  }

  /**
   * Clear bot/squad model overrides that pointed at a deleted provider (or removed model id).
   * Returns how many owners were unbound (they fall back to the global default).
   */
  clearModelBindingsForProvider(providerId: string, removedModelIds?: string[]): number {
    const pid = (providerId || '').trim();
    if (!pid) return 0;
    const removed = new Set((removedModelIds ?? []).map((m) => m.trim()).filter(Boolean));
    let cleared = 0;

    for (const bot of this.listBots()) {
      const bPid = (bot.providerId || '').trim();
      const bMid = (bot.modelId || '').trim();
      if (!bPid && !bMid) continue;
      // Whole provider deleted → clear any binding to it. Model-only removal → matching model.
      const shouldClear = removed.size
        ? bPid === pid && !!bMid && removed.has(bMid)
        : bPid === pid;
      if (!shouldClear) continue;
      try {
        this.updateBot(bot.id, { providerId: '', modelId: '' });
        cleared += 1;
      } catch (err) {
        console.error('[okbot] clear bot model binding failed', bot.id, err);
      }
    }

    for (const squad of this.listSquads()) {
      const sPid = (squad.providerId || '').trim();
      const sMid = (squad.modelId || '').trim();
      if (!sPid && !sMid) continue;
      const shouldClear = removed.size
        ? sPid === pid && !!sMid && removed.has(sMid)
        : sPid === pid;
      if (!shouldClear) continue;
      try {
        this.updateSquad(squad.id, { providerId: '', modelId: '' });
        cleared += 1;
      } catch (err) {
        console.error('[okbot] clear squad model binding failed', squad.id, err);
      }
    }
    return cleared;
  }

    listAllPendingHitl(): Array<PendingHitlRecord & { botId: string }> {
    const out: Array<PendingHitlRecord & { botId: string }> = [];
    for (const entry of this.listRoster()) {
      const data = this.loadPendingHitl(entry.id);
      if (data) out.push({ ...data, botId: entry.id });
    }
    for (const s of this.listSquads()) {
      const data = this.loadPendingHitl(s.id);
      if (data) out.push({ ...data, botId: s.id });
    }
    return out;
  }


  /**
   * Export assistant install package (secrets stripped): avatar / name / persona /
   * AGENTS.md / skills/. `targetPath` ends with `.okbot` → zip; otherwise directory.
   */
  exportAssistantPackage(botId: string, targetPath: string): { path: string } {
    this.assertKnownBotId(botId);
    const roster = this.listRoster().find((b) => b.id === botId);
    if (!roster) throw new Error('助手不存在');
    const config = this.readBotConfig(botId);
    const agentsMd = this.readAgentsMd(botId);
    const skills = this.listSkills(botId);
    const pkg = buildAssistantPackage({
      name: roster.name,
      description: roster.description,
      avatar: {
        avatarKind: config.avatarKind,
        emoji: config.emoji,
        color: config.color,
        ...(config.botAvatarType ? { botAvatarType: config.botAvatarType } : {}),
      },
      agentsMd,
      skills,
    });
    const clean = stripSecrets(pkg);
    const target = path.resolve(targetPath.trim());
    if (target.toLowerCase().endsWith('.okbot')) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-export-'));
      try {
        writeAssistantPackageDir(tmp, clean);
        zipAssistantPackage(tmp, target);
      } finally {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    } else {
      ensureDir(target);
      writeAssistantPackageDir(target, clean);
    }
    return { path: target };
  }

  /**
   * Import assistant package from folder or `.okbot` zip → new bot (no secrets).
   */
  importAssistantPackage(sourcePath: string): Bot {
    const src = path.resolve(sourcePath.trim());
    if (!fs.existsSync(src)) throw new Error('助手包路径不存在');
    const pkg = fs.statSync(src).isDirectory()
      ? readAssistantPackageDir(src)
      : readAssistantPackageArchive(src);
    const clean = stripSecrets(pkg);
    const bot = this.createBot({
      name: clean.manifest.name,
      description: clean.manifest.description,
      emoji: clean.manifest.avatar.emoji,
      color: clean.manifest.avatar.color,
      avatarKind: clean.manifest.avatar.avatarKind,
      botAvatarType: clean.manifest.avatar.botAvatarType,
    });
    if (clean.agentsMd.trim()) {
      this.writeAgentsMd(bot.id, clean.agentsMd);
    }
    for (const skill of clean.skills) {
      this.writeSkill(bot.id, skill);
    }
    const cfg = this.readBotConfig(bot.id);
    cfg.onboardingComplete = true;
    cfg.updatedAt = new Date().toISOString();
    this.writeBotConfig(cfg);
    return this.listBots().find((b) => b.id === bot.id) ?? bot;
  }

}
