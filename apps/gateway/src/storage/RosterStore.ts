import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SOUL_MD,
  clampSoulMd,
  type AppSettings,
  type Bot,
  type BotConfig,
  type BotRosterEntry,
  type Squad,
  type SquadConfig,
  type SquadMember,
  type CreateSquadInput,
  normalizeSquad,
  resolveModelRef,
  normalizeBotAvatarKind,
  normalizeBotAvatarType,
  type BotAvatarKind,
  type BotAvatarShape,
  stripThinkContent,
  clampOwnerDescription,
} from '@okbot/shared';
import { ensureDir, readJson, readJsonResult, handleCorruptJsonRead, writeJson, writeText } from './fs';
import { removeOwnerUsage } from './usageStore';
import {
  localDateYyyyMmDd,
  formatBotId,
  parseBotIdSeqForDate,
  formatSquadId,
  parseSquadIdSeqForDate,
  isSquadOwnerId,
  assertSafeOwnerSegment,
} from './ids';
import type { OwnerLifecycle } from './ownerLifecycle';

export type RosterStoreDeps = {
  root: string;
  botsPath: string;
  squadsPath: string;
  usagePath: string;
  botDir(botId: string): string;
  squadDir(squadId: string): string;
  ownerDir(ownerId: string): string;
  sessionFile(botId: string): string;
  soulMdPath(botId: string): string;
  botSkillsDir(botId: string): string;
  botResourcesDir(botId: string): string;
  botConfigPath(botId: string): string;
  squadConfigPath(squadId: string): string;
  ensureMemoryFile(file: string): void;
  botMemoryPath(botId: string): string;
  noteSessionsChanged(ownerId: string, reason: import('@okbot/shared').SessionsChangedReason): void;
  getSettings(): AppSettings;
};

/** Bots/squads roster + owner layout + deletedOwners id allocation. */
export class RosterStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: RosterStoreDeps,
  ) {}

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
      if (!known.has(id) && !fs.existsSync(this.deps.squadDir(id))) {
        throw new Error(`小队不存在：${id}`);
      }
      return;
    }
    this.assertKnownBotId(id);
  }

  ensureBotLayout(botId: string): void {
    this.life.assertOwnerAlive(botId);
    if (isSquadOwnerId(botId)) {
      this.ensureSquadLayout(botId);
      return;
    }
    ensureDir(this.deps.botDir(botId));
    ensureDir(this.deps.botSkillsDir(botId));
    ensureDir(this.deps.botResourcesDir(botId));
    const soulPath = this.deps.soulMdPath(botId);
    const legacyAgentsPath = path.join(this.deps.botDir(botId), 'AGENTS.md');
    if (!fs.existsSync(soulPath) && !fs.existsSync(legacyAgentsPath)) {
      writeText(soulPath, DEFAULT_SOUL_MD);
    }
    this.deps.ensureMemoryFile(this.deps.botMemoryPath(botId));
  }


  /** `~/.okbot/<squadId>` — session + pending HITL + resources (no SOUL/skills). */
  private squadDir(squadId: string): string {
    return path.join(this.deps.root, squadId);
  }

  ensureSquadLayout(squadId: string): void {
    this.life.assertOwnerAlive(squadId);
    ensureDir(this.deps.squadDir(squadId));
    ensureDir(path.join(this.deps.squadDir(squadId), 'resources'));
    const sf = this.deps.sessionFile(squadId);
    if (!fs.existsSync(sf)) writeText(sf, '');
  }

  /** Bot full layout, or squad session layout. */
  ensureChatLayout(ownerId: string): void {
    if (isSquadOwnerId(ownerId)) {
      this.ensureSquadLayout(ownerId);
      return;
    }
    this.ensureBotLayout(ownerId);
  }

  readSoulMd(botId: string): string {
    this.assertKnownBotId(botId);
    this.ensureBotLayout(botId);
    const soulPath = this.deps.soulMdPath(botId);
    if (fs.existsSync(soulPath)) {
      return fs.readFileSync(soulPath, 'utf8');
    }
    const legacy = path.join(this.deps.botDir(botId), 'AGENTS.md');
    if (fs.existsSync(legacy)) {
      return fs.readFileSync(legacy, 'utf8');
    }
    return DEFAULT_SOUL_MD;
  }

  writeSoulMd(botId: string, content: string): void {
    this.assertKnownBotId(botId);
    this.ensureBotLayout(botId);
    // Never persist model CoT into system instructions (refresh / UI / sync).
    const stripped = stripThinkContent(typeof content === 'string' ? content : '').trimEnd();
    const text = clampSoulMd(stripped.endsWith('\n') ? stripped : `${stripped}\n`);
    const soulPath = this.deps.soulMdPath(botId);
    writeText(soulPath, text);
    // Migrate: drop legacy AGENTS.md after writing SOUL.md.
    const legacy = path.join(this.deps.botDir(botId), 'AGENTS.md');
    if (fs.existsSync(legacy) && path.resolve(legacy) !== path.resolve(soulPath)) {
      try {
        fs.rmSync(legacy, { force: true });
      } catch (err) {
        console.error('[okbot] failed to remove legacy AGENTS.md', botId, err);
      }
    }
  }


  listRoster(): BotRosterEntry[] {
    const loaded = readJsonResult<BotRosterEntry[]>(this.deps.botsPath, []);
    if (
      handleCorruptJsonRead(
        this.deps.botsPath,
        loaded.status,
        loaded.status === 'invalid' ? loaded.error : undefined,
        'bots.json',
      )
    ) {
      return [];
    }
    const raw = loaded.data;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e.id === 'string' && e.id)
      .map((e) => ({
        id: e.id,
        name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : '未命名助手',
        description: typeof e.description === 'string' ? e.description : '',
      }));
  }

  writeRoster(entries: BotRosterEntry[]): void {
    writeJson(
      this.deps.botsPath,
      entries.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
      })),
    );
  }

  readBotConfig(botId: string): BotConfig {
    const file = this.deps.botConfigPath(botId);
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
    const bound = resolveModelRef(this.deps.getSettings().model, {
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
      name:
        typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.trim()
          : '未命名助手',
      description: clampOwnerDescription(raw.description),
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
    const providersOk = (this.deps.getSettings().model.providers?.length ?? 0) > 0;
    if (legacyOnlyModelId && providerId && modelId) {
      // Successful legacy modelId-only → providerId migration.
      this.writeBotConfig(config);
    } else if (dropped && providersOk) {
      // Real mismatch against a loaded catalog: clear stale refs.
      this.writeBotConfig(config);
    }
    return config;
  }

  writeBotConfig(config: BotConfig): void {
    ensureDir(this.deps.botDir(config.id));
    const avatarKind = normalizeBotAvatarKind(config.avatarKind);
    const enabledGlobalSkills = Array.isArray(config.enabledGlobalSkills)
      ? [...new Set(
          config.enabledGlobalSkills
            .filter((s) => typeof s === 'string')
            .map((s) => s.trim())
            .filter(Boolean),
        )]
      : [];
    // Prefer central roster name+description when present so bot.json stays dual-written.
    // createBot writes bot.json before bots.json — fall back to config fields then.
    const roster = this.listRoster().find((e) => e.id === config.id);
    const name =
      (roster?.name.trim() ||
        (typeof config.name === 'string' ? config.name.trim() : '') ||
        '未命名助手');
    const description = clampOwnerDescription(
      roster !== undefined ? roster.description : config.description,
    );
    config.name = name;
    config.description = description;
    writeJson(this.deps.botConfigPath(config.id), {
      id: config.id,
      name,
      description,
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

  /** Dual-write name+description into `<squadId>/squad.json` for folder export. */
  writeSquadConfig(squad: Pick<Squad, 'id' | 'name' | 'description'>): void {
    ensureDir(this.deps.squadDir(squad.id));
    const payload: SquadConfig = {
      id: squad.id,
      name: (squad.name || '').trim() || '未命名小队',
      description: clampOwnerDescription(squad.description),
    };
    writeJson(this.deps.squadConfigPath(squad.id), payload);
  }

  /**
   * Sync roster name+description into `<botId>/bot.json` when missing or stale.
   * Every-load safe: reads raw disk fields and only rewrites on mismatch.
   * No-op when bot.json is absent (cannot invent runtime fields).
   */
  syncBotConfigFromRoster(entry: BotRosterEntry): void {
    const cfgPath = this.deps.botConfigPath(entry.id);
    if (!fs.existsSync(cfgPath)) return;
    const wantName = entry.name.trim() || '未命名助手';
    const wantDesc = clampOwnerDescription(entry.description);
    try {
      const raw = readJson<Record<string, unknown>>(cfgPath, {});
      const haveName =
        typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
      const haveDesc = clampOwnerDescription(raw.description);
      if (haveName === wantName && haveDesc === wantDesc) return;
      const config = this.readBotConfig(entry.id);
      config.name = wantName;
      config.description = wantDesc;
      this.writeBotConfig(config);
    } catch (err) {
      console.error('[okbot] syncBotConfigFromRoster failed', entry.id, err);
    }
  }

  /**
   * Sync squads.json name+description into `<squadId>/squad.json` when missing or stale.
   * Every-load safe: only rewrites on mismatch / missing file.
   */
  syncSquadConfigFromRoster(squad: Pick<Squad, 'id' | 'name' | 'description'>): void {
    const wantName = (squad.name || '').trim() || '未命名小队';
    const wantDesc = clampOwnerDescription(squad.description);
    const cfgPath = this.deps.squadConfigPath(squad.id);
    try {
      if (fs.existsSync(cfgPath)) {
        const raw = readJson<Partial<SquadConfig>>(cfgPath, {});
        const haveName =
          typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
        const haveDesc = clampOwnerDescription(raw.description);
        const haveId = typeof raw.id === 'string' ? raw.id : '';
        if (haveId === squad.id && haveName === wantName && haveDesc === wantDesc) {
          return;
        }
      }
      this.writeSquadConfig({ id: squad.id, name: wantName, description: wantDesc });
    } catch (err) {
      console.error('[okbot] syncSquadConfigFromRoster failed', squad.id, err);
    }
  }

  /**
   * One-shot / every-load migration: walk bots.json + squads.json and dual-write
   * name+description into each owner directory. Safe to call repeatedly.
   */
  syncAllOwnerConfigNameDescriptions(): void {
    for (const entry of this.listRoster()) {
      this.syncBotConfigFromRoster(entry);
    }
    // listSquads already syncs squad.json; call the walker directly to avoid
    // re-entering model-binding rewrite when invoked from FileStorage init.
    const raw = readJson<unknown[]>(this.deps.squadsPath, []);
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      const s = normalizeSquad(item);
      if (!s) continue;
      this.syncSquadConfigFromRoster(s);
    }
  }

  mergeBot(entry: BotRosterEntry, config: BotConfig): Bot {
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
        // Backfill name+description into bot.json for legacy owners (every-load safe).
        this.syncBotConfigFromRoster(entry);
        out.push(this.mergeBot(entry, this.readBotConfig(entry.id)));
      } catch (err) {
        console.error('[okbot] skip bot', entry.id, err);
      }
    }
    return out;
  }


  /** Roster ids + any leftover `bot_*` entries under the data root (dirs/files). */
  collectKnownBotIds(): Set<string> {
    const ids = new Set<string>();
    for (const e of this.listRoster()) {
      if (e.id) ids.add(e.id);
    }
    try {
      for (const name of fs.readdirSync(this.deps.root)) {
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
  allocateNewBotId(): string {
    const dateYmd = localDateYyyyMmDd();
    // Ids deleted in this process stay taken so a tombstoned directory is never reused.
    const known = new Set<string>([...this.collectKnownBotIds(), ...this.life.deletedOwners]);
    let maxSeq = 0;
    for (const id of known) {
      const seq = parseBotIdSeqForDate(id, dateYmd);
      if (seq != null && seq > maxSeq) maxSeq = seq;
    }
    let seq = maxSeq + 1;
    for (;;) {
      const id = formatBotId(dateYmd, seq);
      if (!known.has(id) && !fs.existsSync(this.deps.botDir(id))) return id;
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
      description: clampOwnerDescription(input.description),
    };
    const config: BotConfig = {
      id,
      name: entry.name,
      description: entry.description,
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
        const bound = resolveModelRef(this.deps.getSettings().model, {
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
    writeText(this.deps.sessionFile(id), '');
    const roster = this.listRoster();
    roster.unshift(entry);
    this.writeRoster(roster);
    const bot = this.mergeBot(entry, config);
    this.deps.noteSessionsChanged(id, 'created');
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
    if (patch.description !== undefined) entry.description = clampOwnerDescription(patch.description);
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
        const bound = resolveModelRef(this.deps.getSettings().model, {
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
    // Do not bump updatedAt here — session list sorts by last chat message time
    // (touchBot / touchSquad). Profile edits must not reorder the sidebar.
    roster[idx] = entry;
    this.writeRoster(roster);
    config.name = entry.name;
    config.description = entry.description;
    this.writeBotConfig(config);
    if (profileChanged) {
      this.syncSoulMdProfile(id, entry.name, entry.description);
    }
    const bot = this.mergeBot(entry, config);
    this.deps.noteSessionsChanged(id, 'updated');
    return bot;
  }

  deleteBot(id: string): void {
    const safe = assertSafeOwnerSegment(id);
    this.assertKnownBotId(safe);
    const roster = this.listRoster().filter((b) => b.id !== safe);
    this.writeRoster(roster);
    this.life.markOwnerDeleted(safe);
    const dir = this.deps.botDir(safe);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    this.purgeBotFromSquads(safe);
    try {
      removeOwnerUsage(this.deps.usagePath, safe);
    } catch (err) {
      console.error('[okbot] removeOwnerUsage failed', safe, err);
    }
    this.deps.noteSessionsChanged(safe, 'deleted');
  }



  /** Keep SOUL.md identity line in sync with roster name (short; no duty essay). */
  syncSoulMdProfile(botId: string, name: string, description: string): void {
    this.ensureBotLayout(botId);
    const prev = this.readSoulMd(botId);
    // Prefer modern heading; still rewrite legacy「角色与目标」when present.
    const hasLegacyRole = /^# 角色与目标\s*$/m.test(prev);
    const heading = hasLegacyRole ? '角色与目标' : '个性与边界';
    const identity = [
      `# ${heading}`,
      '',
      `你是「${name}」，用户的本机个人助手。`,
      description.trim()
        ? `对外简介（花名册）：${description.trim()}。`
        : '保持清晰、可靠、有分寸的协作风格。',
      '',
    ].join('\n');

    const stripped = prev
      .replace(/^# (?:个性与边界|角色与目标)\s*\n[\s\S]*?(?=^# |\Z)/m, '')
      .replace(/^\s+/, '');
    this.writeSoulMd(botId, `${identity}${stripped}`);
  }

  /** Mark new-assistant onboarding done so it never repeats (SOUL / description untouched). */
  finishBotOnboarding(botId: string): Bot {
    const roster = this.listRoster();
    const entry = roster.find((b) => b.id === botId);
    if (!entry) throw new Error('助手不存在');
    const config = this.readBotConfig(botId);
    config.onboardingComplete = true;
    config.name = entry.name;
    config.description = entry.description;
    // Keep updatedAt (last chat activity) — finishing onboarding is not a chat message.
    this.writeBotConfig(config);
    const bot = this.mergeBot(entry, config);
    this.deps.noteSessionsChanged(botId, 'updated');
    return bot;
  }



  listSquads(): Squad[] {
    const loaded = readJsonResult<unknown[]>(this.deps.squadsPath, []);
    if (
      handleCorruptJsonRead(
        this.deps.squadsPath,
        loaded.status,
        loaded.status === 'invalid' ? loaded.error : undefined,
        'squads.json',
      )
    ) {
      return [];
    }
    const raw = loaded.data;
    if (!Array.isArray(raw)) return [];
    const modelSettings = this.deps.getSettings().model;
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
    if (dirty) writeJson(this.deps.squadsPath, out);
    // Dual-write name+description into squad.json (missing or out of date).
    for (const s of out) {
      this.syncSquadConfigFromRoster(s);
    }
    return out;
  }

  collectKnownSquadIds(): Set<string> {
    const ids = new Set<string>();
    for (const s of this.listSquads()) {
      if (s.id) ids.add(s.id);
    }
    try {
      for (const name of fs.readdirSync(this.deps.root)) {
        if (name.startsWith('squad_')) ids.add(name);
      }
    } catch {
      /* ignore */
    }
    return ids;
  }

  allocateNewSquadId(): string {
    const dateYmd = localDateYyyyMmDd();
    // Ids deleted in this process stay taken so a tombstoned directory is never reused.
    const known = new Set<string>([...this.collectKnownSquadIds(), ...this.life.deletedOwners]);
    let maxSeq = 0;
    for (const id of known) {
      const seq = parseSquadIdSeqForDate(id, dateYmd);
      if (seq != null && seq > maxSeq) maxSeq = seq;
    }
    let seq = maxSeq + 1;
    for (;;) {
      const id = formatSquadId(dateYmd, seq);
      if (!known.has(id) && !fs.existsSync(this.deps.squadDir(id))) return id;
      seq += 1;
    }
  }

  normalizeSquadMembers(members: SquadMember[]): SquadMember[] {
    const seen = new Set<string>();
    const out: SquadMember[] = [];
    for (const m of members) {
      const botId = (m?.botId || '').trim();
      if (!botId || seen.has(botId)) continue;
      seen.add(botId);
      out.push({ botId });
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
    const bound = resolveModelRef(this.deps.getSettings().model, {
      providerId: input.providerId,
      modelId: input.modelId,
    });
    const now = new Date().toISOString();
    const squad: Squad = {
      id: this.allocateNewSquadId(),
      name,
      description: clampOwnerDescription(input.description),
      members,
      createdAt: now,
      updatedAt: now,
    };
    if (bound.providerId) squad.providerId = bound.providerId;
    if (bound.modelId) squad.modelId = bound.modelId;
    const list = this.listSquads();
    list.unshift(squad);
    writeJson(this.deps.squadsPath, list);
    this.ensureSquadLayout(squad.id);
    this.writeSquadConfig(squad);
    this.deps.noteSessionsChanged(squad.id, 'created');
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
        patch.description !== undefined
          ? clampOwnerDescription(patch.description)
          : prev.description,
      members,
      createdAt: prev.createdAt,
      // Session list sorts by last chat message time (touchSquad); profile edits must not reorder.
      updatedAt: prev.updatedAt,
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
        const bound = resolveModelRef(this.deps.getSettings().model, {
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
    writeJson(this.deps.squadsPath, list);
    this.ensureSquadLayout(id);
    this.writeSquadConfig(next);
    this.deps.noteSessionsChanged(id, 'updated');
    return next;
  }

  deleteSquad(id: string): void {
    const safe = assertSafeOwnerSegment(id);
    if (!isSquadOwnerId(safe) || !this.listSquads().some((s) => s.id === safe)) {
      throw new Error(`小队不存在：${safe}`);
    }
    writeJson(
      this.deps.squadsPath,
      this.listSquads().filter((s) => s.id !== safe),
    );
    this.life.markOwnerDeleted(safe);
    const dir = this.deps.squadDir(safe);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    try {
      removeOwnerUsage(this.deps.usagePath, safe);
    } catch (err) {
      console.error('[okbot] removeOwnerUsage failed', safe, err);
    }
    this.deps.noteSessionsChanged(safe, 'deleted');
  }

  /** Drop a deleted bot from all squads; delete squads that fall below 2 members. */
  purgeBotFromSquads(botId: string): void {
    const kept: Squad[] = [];
    const removed: string[] = [];
    for (const s of this.listSquads()) {
      const members = s.members.filter((m) => m.botId !== botId);
      if (members.length < 2) {
        this.life.markOwnerDeleted(s.id);
        const dir = this.deps.squadDir(s.id);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        removed.push(s.id);
        continue;
      }
      // Preserve updatedAt — membership cleanup is not chat activity.
      const next: Squad = { ...s, members };
      kept.push(next);
    }
    writeJson(this.deps.squadsPath, kept);
    for (const id of removed) {
      try {
        removeOwnerUsage(this.deps.usagePath, id);
      } catch (err) {
        console.error('[okbot] removeOwnerUsage failed', id, err);
      }
      this.deps.noteSessionsChanged(id, 'deleted');
    }
  }

  /** Bump squad updatedAt (session-list sort key) after a chat message. */
  touchSquad(id: string): Squad {
    const list = this.listSquads();
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('小队不存在');
    const cur = list[idx]!;
    const next: Squad = { ...cur, updatedAt: new Date().toISOString() };
    list.splice(idx, 1);
    list.unshift(next);
    writeJson(this.deps.squadsPath, list);
    this.writeSquadConfig(next);
    return next;
  }

  /** Bump bot updatedAt (session-list sort key) and roster recents after a chat message. */
  touchBot(id: string): Bot {
    const roster = this.listRoster();
    const idx = roster.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error('助手不存在');
    const entry = roster[idx]!;
    const config = this.readBotConfig(id);
    config.updatedAt = new Date().toISOString();
    config.name = entry.name;
    config.description = entry.description;
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
      writeJson(this.deps.squadsPath, list);
      this.writeSquadConfig(next);
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
}
