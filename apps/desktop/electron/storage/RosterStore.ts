import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_AGENTS_MD,
  type AppSettings,
  type Bot,
  type BotConfig,
  type BotOnboardingAnswers,
  type BotRosterEntry,
  type Squad,
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
import { ensureDir, readJson, writeJson, writeText } from './fs';
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
  agentsMdPath(botId: string): string;
  botSkillsDir(botId: string): string;
  botResourcesDir(botId: string): string;
  botConfigPath(botId: string): string;
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
    const agents = this.deps.agentsMdPath(botId);
    if (!fs.existsSync(agents)) {
      writeText(agents, DEFAULT_AGENTS_MD);
    }
    this.deps.ensureMemoryFile(this.deps.botMemoryPath(botId));
  }


  /** `~/.okbot/<squadId>` — session + pending HITL + resources (no AGENTS/skills). */
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

  readAgentsMd(botId: string): string {
    this.assertKnownBotId(botId);
    this.ensureBotLayout(botId);
    return fs.readFileSync(this.deps.agentsMdPath(botId), 'utf8');
  }

  writeAgentsMd(botId: string, content: string): void {
    this.assertKnownBotId(botId);
    this.ensureBotLayout(botId);
    // Never persist model CoT into system instructions (refresh / UI / sync).
    const stripped = stripThinkContent(typeof content === 'string' ? content : '').trimEnd();
    const text = stripped.endsWith('\n') ? stripped : `${stripped}\n`;
    writeText(this.deps.agentsMdPath(botId), text);
  }


  listRoster(): BotRosterEntry[] {
    const raw = readJson<BotRosterEntry[]>(this.deps.botsPath, []);
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
    writeJson(this.deps.botConfigPath(config.id), {
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
    this.writeBotConfig(config);
    if (profileChanged) {
      this.syncAgentsMdProfile(id, entry.name, entry.description);
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



  /** Keep AGENTS.md identity lines in sync with roster name/description. */
  syncAgentsMdProfile(botId: string, name: string, description: string): void {
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
    // Keep updatedAt (last chat activity) — finishing onboarding is not a chat message.
    this.writeBotConfig(config);
    const bot = this.mergeBot(entry, config);
    this.deps.noteSessionsChanged(botId, 'updated');
    return bot;
  }



  listSquads(): Squad[] {
    const raw = readJson<unknown[]>(this.deps.squadsPath, []);
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
