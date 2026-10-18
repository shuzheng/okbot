import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Bot,
  type BotOnboardingAnswers,
  type BotSkill,
  type MemoryEntry,
  type SessionSummary,
  type BotRosterEntry,
  type ChatMessage,
  type Squad,
  type CreateSquadInput,
  type MessagesPage,
  type MessageSearchHit,
  type BotAvatarKind,
  type BotAvatarShape,
  type TokenUsage,
  type UsageStats,
  type SessionsChangedReason,
  type ScheduledJobInfo,
} from '@okbot/shared';
import type { AssistantPackageContents } from '@okbot/agent';
import { ensureDir, writeJson } from './fs';
import { loadUsageStats, recordTokenUsage } from './usageStore';
import { assertSafeOwnerSegment } from './ids';
import type { SessionRecordV2, PendingHitlRecord, TaskProgressRecord, RunCheckpointRecord, TaskRecord } from './types';
import type { ScheduledJob } from './schedules';
import { OwnerLifecycle } from './ownerLifecycle';
import { SettingsStore } from './SettingsStore';
import { MemoryStore } from './MemoryStore';
import { SkillsStore } from './SkillsStore';
import { SessionStore } from './SessionStore';
import { ScheduleStore } from './ScheduleStore';
import { PendingHitlStore } from './PendingHitlStore';
import {
  TaskProgressStore,
  formatTasksForPrompt,
  hasUnfinishedTasks,
  fingerprintTasks,
} from './TaskProgressStore';
import { RunCheckpointStore } from './RunCheckpointStore';
import { RosterStore } from './RosterStore';
import { AssistantPackageStore } from './AssistantPackageStore';

export type { SessionRecordV2, PendingHitlRecord, TaskProgressRecord, RunCheckpointRecord, TaskRecord } from './types';

/**
 * Thin facade over domain stores. Owns shared root paths, constructs stores,
 * and keeps the historical FileStorage call surface stable for callers.
 *
 * Tombstone (`assertOwnerAlive` / `deletedOwners`) and session write lock live
 * only on {@link OwnerLifecycle}; write paths that must honor them do so inside
 * the relevant store (not copy-pasted on this facade).
 */
export class FileStorage {
  readonly root: string;
  private readonly botsPath: string;
  private readonly squadsPath: string;
  private readonly settingsPath: string;
  private readonly windowPath: string;
  private readonly usagePath: string;

  private readonly life: OwnerLifecycle;
  private readonly settingsStore: SettingsStore;
  private readonly memoryStore: MemoryStore;
  private readonly skillsStore: SkillsStore;
  private readonly sessionStore: SessionStore;
  private readonly scheduleStore: ScheduleStore;
  private readonly pendingHitlStore: PendingHitlStore;
  private readonly taskProgressStore: TaskProgressStore;
  private readonly runCheckpointStore: RunCheckpointStore;
  private readonly rosterStore: RosterStore;
  private readonly assistantPackageStore: AssistantPackageStore;

  private sessionsChangedListener:
    | ((ownerId: string, reason: SessionsChangedReason) => void)
    | null = null;

  constructor(root?: string) {
    this.root = root ?? path.join(os.homedir(), '.okbot');
    this.botsPath = path.join(this.root, 'bots.json');
    this.squadsPath = path.join(this.root, 'squads.json');
    this.settingsPath = path.join(this.root, 'settings.json');
    this.windowPath = path.join(this.root, 'window.json');
    this.usagePath = path.join(this.root, 'usage.json');

    this.life = new OwnerLifecycle((ownerId) => this.ownerDir(ownerId));
    this.settingsStore = new SettingsStore(this.root, this.settingsPath, this.windowPath);

    ensureDir(this.root);
    this.settingsStore.restrictDataDir();
    if (!fs.existsSync(this.botsPath)) writeJson(this.botsPath, [] as BotRosterEntry[]);
    if (!fs.existsSync(this.squadsPath)) writeJson(this.squadsPath, [] as Squad[]);
    if (!fs.existsSync(this.settingsPath)) this.settingsStore.writeSettingsFile(DEFAULT_SETTINGS);
    else this.settingsStore.restrictSettingsFile();

    this.memoryStore = new MemoryStore(this.life, {
      root: this.root,
      botDir: (id) => this.botDir(id),
      ensureBotLayout: (id) => this.rosterStore.ensureBotLayout(id),
      assertKnownBotId: (id) => this.rosterStore.assertKnownBotId(id),
      getSettings: () => this.settingsStore.getSettings(),
    });
    this.memoryStore.ensureMemoryFile(this.memoryStore.globalMemoryPath());

    this.rosterStore = new RosterStore(this.life, {
      root: this.root,
      botsPath: this.botsPath,
      squadsPath: this.squadsPath,
      usagePath: this.usagePath,
      botDir: (id) => this.botDir(id),
      squadDir: (id) => this.squadDir(id),
      ownerDir: (id) => this.ownerDir(id),
      sessionFile: (id) => this.sessionFile(id),
      soulMdPath: (id) => this.soulMdPath(id),
      botSkillsDir: (id) => this.botSkillsDir(id),
      botResourcesDir: (id) => this.botResourcesDir(id),
      botConfigPath: (id) => this.botConfigPath(id),
      squadConfigPath: (id) => this.squadConfigPath(id),
      ensureMemoryFile: (file) => this.memoryStore.ensureMemoryFile(file),
      botMemoryPath: (id) => this.memoryStore.botMemoryPath(id),
      noteSessionsChanged: (id, reason) => this.noteSessionsChanged(id, reason),
      getSettings: () => this.settingsStore.getSettings(),
    });

    this.skillsStore = new SkillsStore(this.life, {
      botSkillsDir: (id) => this.botSkillsDir(id),
      ensureBotLayout: (id) => this.rosterStore.ensureBotLayout(id),
      assertKnownBotId: (id) => this.rosterStore.assertKnownBotId(id),
      readBotConfig: (id) => this.rosterStore.readBotConfig(id),
    });

    this.sessionStore = new SessionStore(this.life, {
      ensureBotLayout: (id) => this.rosterStore.ensureBotLayout(id),
      sessionFile: (id) => this.sessionFile(id),
      noteSessionsChanged: (id, reason) => this.noteSessionsChanged(id, reason),
      listBots: () => this.rosterStore.listBots(),
      listSquads: () => this.rosterStore.listSquads(),
    });

    this.scheduleStore = new ScheduleStore(this.life, {
      ownerDir: (id) => this.ownerDir(id),
      ensureChatLayout: (id) => this.rosterStore.ensureChatLayout(id),
      assertKnownOwnerId: (id) => this.rosterStore.assertKnownOwnerId(id),
      listBots: () => this.rosterStore.listBots(),
      listSquads: () => this.rosterStore.listSquads(),
      getAppTimezone: () => this.settingsStore.getSettings().timezone || '',
    });

    this.pendingHitlStore = new PendingHitlStore(this.life, {
      botDir: (id) => this.botDir(id),
      ensureBotLayout: (id) => this.rosterStore.ensureBotLayout(id),
      listRoster: () => this.rosterStore.listRoster(),
      listSquads: () => this.rosterStore.listSquads(),
    });

    this.taskProgressStore = new TaskProgressStore(this.life, {
      botDir: (id) => this.botDir(id),
      ensureBotLayout: (id) => this.rosterStore.ensureBotLayout(id),
    });

    this.runCheckpointStore = new RunCheckpointStore(this.life, {
      botDir: (id) => this.botDir(id),
      ensureBotLayout: (id) => this.rosterStore.ensureBotLayout(id),
      listRoster: () => this.rosterStore.listRoster(),
      listSquads: () => this.rosterStore.listSquads(),
    });

    this.assistantPackageStore = new AssistantPackageStore(this.life, {
      assertKnownBotId: (id) => this.rosterStore.assertKnownBotId(id),
      listRoster: () => this.rosterStore.listRoster(),
      readBotConfig: (id) => this.rosterStore.readBotConfig(id),
      readSoulMd: (id) => this.rosterStore.readSoulMd(id),
      listSkills: (id) => this.skillsStore.listSkills(id),
      createBot: (input) => this.rosterStore.createBot(input),
      writeSoulMd: (id, content) => this.rosterStore.writeSoulMd(id, content),
      writeSkill: (id, skill) => this.skillsStore.writeSkill(id, skill),
      writeBotConfig: (cfg) => this.rosterStore.writeBotConfig(cfg),
      deleteBot: (id) => this.rosterStore.deleteBot(id),
      listBots: () => this.rosterStore.listBots(),
    });

    // Backfill name+description into each <id>/bot.json and <id>/squad.json for
    // owners created before dual-write. Every-load safe (only rewrites on mismatch).
    this.rosterStore.syncAllOwnerConfigNameDescriptions();
  }

  // ── paths / layout (shared) ─────────────────────────────────

  private botDir(botId: string): string {
    return path.join(this.root, botId);
  }

  private squadDir(squadId: string): string {
    return path.join(this.root, squadId);
  }

  ownerDir(ownerId: string): string {
    return path.join(this.root, ownerId);
  }

  private sessionFile(botId: string): string {
    return path.join(this.botDir(botId), 'session.jsonl');
  }

  private soulMdPath(botId: string): string {
    return path.join(this.botDir(botId), 'SOUL.md');
  }

  private botSkillsDir(botId: string): string {
    return path.join(this.botDir(botId), 'skills');
  }

  private botResourcesDir(botId: string): string {
    return path.join(this.botDir(botId), 'resources');
  }

  private botConfigPath(botId: string): string {
    return path.join(this.botDir(botId), 'bot.json');
  }

  private squadConfigPath(squadId: string): string {
    return path.join(this.squadDir(squadId), 'squad.json');
  }

  ownerResourcesDir(ownerId: string): string {
    const id = assertSafeOwnerSegment(ownerId);
    this.life.assertOwnerAlive(id);
    const dir = path.join(this.ownerDir(id), 'resources');
    ensureDir(dir);
    return dir;
  }

  ownerUploadsDir(ownerId: string): string {
    const id = assertSafeOwnerSegment(ownerId);
    this.life.assertOwnerAlive(id);
    const dir = path.join(this.ownerDir(id), 'uploads');
    ensureDir(dir);
    return dir;
  }

  /**
   * Persist a composer attachment under ~/.okbot/<ownerId>/uploads/.
   * Returns gateway-absolute path + media pathname for chat display.
   */
  saveOwnerUpload(
    ownerId: string,
    input: { name: string; buffer: Buffer; mime?: string | null },
  ): {
    kind: 'image' | 'file';
    path: string;
    name: string;
    size: number;
    mediaPath: string;
    assetRel: string;
  } {
    const id = assertSafeOwnerSegment(ownerId);
    this.life.assertOwnerAlive(id);
    const buf = input.buffer;
    if (!Buffer.isBuffer(buf) || buf.length <= 0) {
      throw new Error('empty_upload');
    }
    const maxBytes = 25 * 1024 * 1024;
    if (buf.length > maxBytes) {
      throw new Error('upload_too_large');
    }
    const rawName = (input.name || 'file').trim() || 'file';
    const base = path.basename(rawName.replace(/\\/g, '/'));
    const safeBase =
      base
        .replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]+/g, '_')
        .replace(/^[._]+/, '')
        .slice(0, 120) || 'file';
    const ext = path.extname(safeBase).toLowerCase();
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
    const mime = (input.mime || '').toLowerCase();
    const kind: 'image' | 'file' =
      imageExts.has(ext) || mime.startsWith('image/') ? 'image' : 'file';
    // Prefer a real image extension when clipboard paste only had a mime.
    let finalName = safeBase;
    if (kind === 'image' && !imageExts.has(ext)) {
      const fromMime =
        mime === 'image/jpeg' || mime === 'image/jpg'
          ? '.jpg'
          : mime === 'image/webp'
            ? '.webp'
            : mime === 'image/gif'
              ? '.gif'
              : mime === 'image/bmp'
                ? '.bmp'
                : '.png';
      finalName = `${safeBase}${fromMime}`;
    }
    const unique = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${finalName}`;
    const dir = this.ownerUploadsDir(id);
    const filePath = path.join(dir, unique);
    fs.writeFileSync(filePath, buf);
    const assetRel = `${id}/uploads/${unique}`;
    const mediaPath = `/v1/media/${encodeURIComponent(id)}/uploads/${encodeURIComponent(unique)}`;
    return {
      kind,
      path: filePath,
      name: finalName,
      size: buf.length,
      mediaPath,
      assetRel,
    };
  }


  /** List files in owner `resources/` (newest mtime first). Non-recursive. */
  listOwnerResources(ownerId: string): import('@okbot/shared').OwnerResourceInfo[] {
    const id = assertSafeOwnerSegment(ownerId);
    this.life.assertOwnerAlive(id);
    const dir = path.join(this.ownerDir(id), 'resources');
    if (!fs.existsSync(dir)) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: import('@okbot/shared').OwnerResourceInfo[] = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const name = ent.name;
      if (!name || name.startsWith('.')) continue;
      if (name.includes('/') || name.includes('\\') || name.includes('..')) continue;
      const filePath = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const ext = path.extname(name).toLowerCase();
      const mime =
        ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.png'
            ? 'image/png'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.gif'
                ? 'image/gif'
                : ext === '.svg'
                  ? 'image/svg+xml'
                  : ext === '.md'
                    ? 'text/markdown'
                    : ext === '.txt' || ext === '.log'
                      ? 'text/plain'
                      : ext === '.json'
                        ? 'application/json'
                        : ext === '.csv'
                          ? 'text/csv'
                          : 'application/octet-stream';
      out.push({
        name,
        path: filePath,
        size: st.size,
        createdAt: new Date(st.mtimeMs).toISOString(),
        mime,
        assetRel: `${id}/resources/${name}`,
      });
    }
    out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.name.localeCompare(a.name));
    return out;
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

  setSessionsChangedListener(
    listener: ((ownerId: string, reason: SessionsChangedReason) => void) | null,
  ): void {
    this.sessionsChangedListener = listener;
  }

  isOwnerDeleted(ownerId: string): boolean {
    return this.life.isOwnerDeleted(ownerId);
  }

  assertKnownBotId(botId: string): void {
    this.rosterStore.assertKnownBotId(botId);
  }

  assertKnownOwnerId(ownerId: string): void {
    this.rosterStore.assertKnownOwnerId(ownerId);
  }

  // ── settings / window / usage ───────────────────────────────

  takeSettingsLoadWarning(): string | null {
    return this.settingsStore.takeSettingsLoadWarning();
  }

  getSettings(): AppSettings {
    return this.settingsStore.getSettings();
  }

  saveSettings(settings: AppSettings): AppSettings {
    return this.settingsStore.saveSettings(settings);
  }

  getWindowBounds(): { x: number; y: number; width: number; height: number } | null {
    return this.settingsStore.getWindowBounds();
  }

  saveWindowBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.settingsStore.saveWindowBounds(bounds);
  }

  getUsageStats(): UsageStats {
    return loadUsageStats(this.usagePath);
  }

  recordUsage(
    ownerId: string,
    usage: TokenUsage,
    opts?: { alsoOwnerIds?: string[]; skipLifetime?: boolean },
  ): UsageStats {
    return recordTokenUsage(this.usagePath, ownerId, usage, {
      ...opts,
      skipOwnerIds: this.life.deletedOwners,
    });
  }

  // ── memory ──────────────────────────────────────────────────

  listGlobalMemories(): MemoryEntry[] {
    return this.memoryStore.listGlobalMemories();
  }

  listBotMemories(botId: string): MemoryEntry[] {
    return this.memoryStore.listBotMemories(botId);
  }

  upsertMemory(scope: 'global' | 'bot', entry: MemoryEntry): void {
    this.memoryStore.upsertMemory(scope, entry);
  }

  deleteMemory(scope: 'global' | 'bot', botId: string, memoryId: string): void {
    this.memoryStore.deleteMemory(scope, botId, memoryId);
  }

  readSessionSummary(botId: string): SessionSummary | null {
    return this.memoryStore.readSessionSummary(botId);
  }

  writeSessionSummary(botId: string, entry: SessionSummary): void {
    this.memoryStore.writeSessionSummary(botId, entry);
  }

  formatMemoriesForPrompt(botId: string): string {
    return this.memoryStore.formatMemoriesForPrompt(botId);
  }

  // ── skills ──────────────────────────────────────────────────

  botSkillsDirPublic(botId: string): string {
    return this.skillsStore.botSkillsDirPublic(botId);
  }

  globalAgentsSkillsDirPublic(): string {
    return this.skillsStore.globalAgentsSkillsDirPublic();
  }

  listSkills(botId: string): BotSkill[] {
    return this.skillsStore.listSkills(botId);
  }

  listGlobalAgentsSkills(): BotSkill[] {
    return this.skillsStore.listGlobalAgentsSkills();
  }

  resolveEnabledSkill(
    botId: string,
    slug: string,
  ): (BotSkill & { source: 'local' | 'global' }) | null {
    return this.skillsStore.resolveEnabledSkill(botId, slug);
  }

  formatSkillsForPrompt(botId: string): string {
    return this.skillsStore.formatSkillsForPrompt(botId);
  }

  writeSkill(botId: string, skill: BotSkill): void {
    this.skillsStore.writeSkill(botId, skill);
  }

  deleteSkill(botId: string, slug: string): void {
    this.skillsStore.deleteSkill(botId, slug);
  }

  // ── agents.md ───────────────────────────────────────────────

  readSoulMd(botId: string): string {
    return this.rosterStore.readSoulMd(botId);
  }

  writeSoulMd(botId: string, content: string): void {
    this.rosterStore.writeSoulMd(botId, content);
  }

  // ── roster / bots / squads ──────────────────────────────────

  listBots(): Bot[] {
    return this.rosterStore.listBots();
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
    return this.rosterStore.createBot(input);
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
    return this.rosterStore.updateBot(id, patch);
  }

  deleteBot(id: string): void {
    this.rosterStore.deleteBot(id);
  }

  finishBotOnboarding(botId: string, answers: BotOnboardingAnswers = {}): Bot {
    return this.rosterStore.finishBotOnboarding(botId, answers);
  }

  listSquads(): Squad[] {
    return this.rosterStore.listSquads();
  }

  createSquad(input: CreateSquadInput): Squad {
    return this.rosterStore.createSquad(input);
  }

  updateSquad(
    id: string,
    patch: Partial<Pick<Squad, 'name' | 'description' | 'members' | 'providerId' | 'modelId'>>,
  ): Squad {
    return this.rosterStore.updateSquad(id, patch);
  }

  deleteSquad(id: string): void {
    this.rosterStore.deleteSquad(id);
  }

  touchSquad(id: string): Squad {
    return this.rosterStore.touchSquad(id);
  }

  touchBot(id: string): Bot {
    return this.rosterStore.touchBot(id);
  }

  setHasUnreadReply(ownerId: string, hasUnread: boolean): void {
    this.rosterStore.setHasUnreadReply(ownerId, hasUnread);
  }

  clearModelBindingsForProvider(providerId: string, removedModelIds?: string[]): number {
    return this.rosterStore.clearModelBindingsForProvider(providerId, removedModelIds);
  }

  // ── schedules ───────────────────────────────────────────────

  listScheduledJobs(ownerId: string): ScheduledJob[] {
    return this.scheduleStore.listScheduledJobs(ownerId);
  }

  manageScheduledJobs(
    ownerId: string,
    input: {
      action: 'create' | 'list' | 'pause' | 'resume' | 'delete';
      prompt?: string;
      title?: string;
      schedule?: string;
      timezone?: string;
      jobId?: string;
      once?: boolean;
    },
  ): string {
    return this.scheduleStore.manageScheduledJobs(ownerId, input);
  }

  listAllScheduledJobInfos(): ScheduledJobInfo[] {
    return this.scheduleStore.listAllScheduledJobInfos();
  }

  listAllEnabledScheduledJobs(): ScheduledJob[] {
    return this.scheduleStore.listAllEnabledScheduledJobs();
  }

  claimScheduledJobDue(ownerId: string, jobId: string, now: Date = new Date()): ScheduledJob | null {
    return this.scheduleStore.claimScheduledJobDue(ownerId, jobId, now);
  }

  markScheduledJobFired(
    ownerId: string,
    jobId: string,
    result: { ok: boolean; error?: string; firedAt?: Date },
  ): ScheduledJob | null {
    return this.scheduleStore.markScheduledJobFired(ownerId, jobId, result);
  }

  // ── session / messages ──────────────────────────────────────

  readSessionItems(botId: string, limit?: number): Record<string, unknown>[] {
    return this.sessionStore.readSessionItems(botId, limit);
  }

  appendSessionItems(
    botId: string,
    items: Record<string, unknown>[],
    meta?: SessionRecordV2['meta'],
  ): void {
    this.sessionStore.appendSessionItems(botId, items, meta);
  }

  popSessionItem(botId: string): Record<string, unknown> | undefined {
    return this.sessionStore.popSessionItem(botId);
  }

  clearSessionItems(botId: string): void {
    this.sessionStore.clearSessionItems(botId);
  }

  replaceSessionItems(botId: string, items: Record<string, unknown>[]): void {
    this.sessionStore.replaceSessionItems(botId, items);
  }

  listSessionBudgetRows(botId: string): Array<{ id: string; item: Record<string, unknown> }> {
    return this.sessionStore.listSessionBudgetRows(botId);
  }

  readSessionItemsAfter(
    botId: string,
    afterMessageId?: string | null,
    limit?: number,
    omitRecordIds?: ReadonlySet<string> | null,
    parallel?: {
      runId?: string | null;
      baselineIds?: ReadonlySet<string> | null;
    } | null,
  ): Record<string, unknown>[] {
    return this.sessionStore.readSessionItemsAfter(
      botId,
      afterMessageId,
      limit,
      omitRecordIds,
      parallel,
    );
  }

  createSessionStore(
    botId: string,
    opts?: {
      afterMessageId?: string | null;
      omitRecordIds?: string[] | null;
      runId?: string | null;
    },
  ): {
    getSessionId: () => string;
    readItems: (limit?: number) => Record<string, unknown>[];
    appendItems: (items: Record<string, unknown>[]) => void | Promise<void>;
    popItem: () => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>;
    clearItems: () => void | Promise<void>;
    replaceItems: (items: Record<string, unknown>[]) => void | Promise<void>;
  } {
    return this.sessionStore.createSessionStore(botId, opts);
  }

  getMessages(botId: string): ChatMessage[] {
    return this.sessionStore.getMessages(botId);
  }

  getMessagesPage(
    botId: string,
    opts?: { limit?: number; beforeMessageId?: string | null },
  ): MessagesPage {
    return this.sessionStore.getMessagesPage(botId, opts);
  }

  async searchMessagesForOwner(
    ownerId: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<MessageSearchHit[]> {
    return this.sessionStore.searchMessagesForOwner(ownerId, query, opts);
  }

  async searchMessages(query: string, opts?: { limit?: number }): Promise<MessageSearchHit[]> {
    return this.sessionStore.searchMessages(query, opts);
  }

  getLastReplyPreview(ownerId: string): string {
    return this.sessionStore.getLastReplyPreview(ownerId);
  }

  withReplyPreviews<T extends { id: string }>(owners: T[]): Array<T & { lastReplyPreview?: string }> {
    return this.sessionStore.withReplyPreviews(owners);
  }

  getMessageById(ownerId: string, messageId: string): ChatMessage | null {
    return this.sessionStore.getMessageById(ownerId, messageId);
  }

  getSessionItemsThroughMessage(
    botId: string,
    messageId: string,
    opts?: { afterMessageId?: string | null },
  ): { items: Record<string, unknown>[]; found: boolean } {
    return this.sessionStore.getSessionItemsThroughMessage(botId, messageId, opts);
  }

  patchMessage(botId: string, messageId: string, patch: Partial<ChatMessage>): ChatMessage | null {
    return this.sessionStore.patchMessage(botId, messageId, patch);
  }

  appendMessage(botId: string, message: ChatMessage): void {
    this.sessionStore.appendMessage(botId, message);
  }

  async upsertAssistantMessage(
    botId: string,
    message: ChatMessage,
    opts?: { allowRebind?: boolean; runId?: string | null },
  ): Promise<void> {
    return this.sessionStore.upsertAssistantMessage(botId, message, opts);
  }

  // ── pending HITL ────────────────────────────────────────────

  savePendingHitl(botId: string, data: PendingHitlRecord): void {
    this.pendingHitlStore.savePendingHitl(botId, data);
  }

  listPendingHitl(botId: string): PendingHitlRecord[] {
    return this.pendingHitlStore.listPendingHitl(botId);
  }

  loadPendingHitl(botId: string): PendingHitlRecord | null {
    return this.pendingHitlStore.loadPendingHitl(botId);
  }

  clearPendingHitlRequest(botId: string, requestId: string): void {
    this.pendingHitlStore.clearPendingHitlRequest(botId, requestId);
  }

  clearPendingHitl(botId: string): void {
    this.pendingHitlStore.clearPendingHitl(botId);
  }

  readSquadResumeReplies(
    squadId: string,
    turnId: string,
  ): Array<{ memberBotId: string; memberName: string; task: string; reply: string }> {
    return this.pendingHitlStore.readSquadResumeReplies(squadId, turnId);
  }

  writeSquadResumeReplies(
    squadId: string,
    turnId: string,
    replies: Array<{ memberBotId: string; memberName: string; task: string; reply: string }>,
  ): void {
    this.pendingHitlStore.writeSquadResumeReplies(squadId, turnId, replies);
  }

  listAllPendingHitl(): Array<PendingHitlRecord & { botId: string }> {
    return this.pendingHitlStore.listAllPendingHitl();
  }

  // ── multi-task queue (tasks.jsonl) ───────────────────────────

  loadTasks(ownerId: string): TaskRecord[] {
    return this.taskProgressStore.loadAll(ownerId);
  }

  loadOpenTasks(ownerId: string): TaskRecord[] {
    return this.taskProgressStore.loadOpen(ownerId);
  }

  /** @deprecated Prefer loadTasks — returns a legacy single-plan view. */
  loadTaskProgress(ownerId: string): TaskProgressRecord {
    return this.taskProgressStore.load(ownerId);
  }

  formatTaskProgressForPrompt(ownerId: string): string {
    return formatTasksForPrompt(this.taskProgressStore.loadAll(ownerId));
  }

  hasUnfinishedTasks(ownerId: string): boolean {
    return hasUnfinishedTasks(this.taskProgressStore.loadAll(ownerId));
  }

  fingerprintTasks(ownerId: string): string {
    return fingerprintTasks(this.taskProgressStore.loadAll(ownerId));
  }

  addTask(
    ownerId: string,
    input: {
      id?: string;
      title?: string;
      note?: string;
      status?: import('@okbot/shared').TaskStatus;
      steps?: Array<{
        id?: string;
        title: string;
        status?: import('@okbot/shared').TaskStatus;
        note?: string;
      }>;
    },
  ): TaskRecord {
    return this.taskProgressStore.addTask(ownerId, input);
  }

  updateTask(
    ownerId: string,
    input: {
      id: string;
      title?: string;
      note?: string;
      status?: import('@okbot/shared').TaskStatus;
      steps?: Array<{
        id?: string;
        title: string;
        status?: import('@okbot/shared').TaskStatus;
        note?: string;
      }>;
      step_id?: string;
      step_title?: string;
      step_status?: import('@okbot/shared').TaskStatus;
      step_note?: string;
      step_new_title?: string;
    },
  ): TaskRecord {
    return this.taskProgressStore.updateTask(ownerId, input);
  }

  /** @deprecated Legacy set_plan → addTask. */
  setTaskProgressPlan(
    ownerId: string,
    input: {
      title?: string;
      items: Array<{ id?: string; title: string; status?: import('./types').TaskProgressItemStatus; note?: string }>;
    },
  ): TaskProgressRecord {
    return this.taskProgressStore.setPlan(ownerId, input);
  }

  /** @deprecated Legacy update_item. */
  updateTaskProgressItem(
    ownerId: string,
    input: {
      id?: string;
      title?: string;
      status?: import('./types').TaskProgressItemStatus;
      note?: string;
      new_title?: string;
    },
  ): TaskProgressRecord {
    return this.taskProgressStore.updateItem(ownerId, input);
  }

  clearTaskProgress(ownerId: string): void {
    this.taskProgressStore.clear(ownerId);
  }

  // ── run checkpoint ──────────────────────────────────────────

  saveRunCheckpoint(
    ownerId: string,
    data: Omit<RunCheckpointRecord, 'v' | 'ownerId' | 'updatedAt'> & { updatedAt?: string },
  ): void {
    this.runCheckpointStore.save(ownerId, data);
  }

  loadRunCheckpoint(ownerId: string): RunCheckpointRecord | null {
    return this.runCheckpointStore.load(ownerId);
  }

  clearRunCheckpoint(ownerId: string): void {
    this.runCheckpointStore.clear(ownerId);
  }

  listAllRunCheckpoints(): RunCheckpointRecord[] {
    return this.runCheckpointStore.listAll();
  }

  // ── packages ────────────────────────────────────────────────

  exportAssistantPackage(botId: string, targetPath: string): { path: string } {
    return this.assistantPackageStore.exportAssistantPackage(botId, targetPath);
  }

  importAssistantPackage(sourcePath: string): Bot {
    return this.assistantPackageStore.importAssistantPackage(sourcePath);
  }

  installAssistantPackage(pkg: AssistantPackageContents): Bot {
    return this.assistantPackageStore.installAssistantPackage(pkg);
  }
}
