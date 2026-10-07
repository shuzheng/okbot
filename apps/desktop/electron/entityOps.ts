import {
  DEFAULT_TOOL_PREFERENCES,
  DEFAULT_SQUAD_SETTINGS,
  type BotOnboardingAnswers,
  type BotSkill,
  type CreateSquadInput,
  type MemoryEntry,
} from '@okbot/shared';
import {
  allocateAskToolNames,
  buildAgentInstructions,
  buildCaptainSquadInstructions,
  formatComputerRoutingSection,
  formatSessionPromptContext,
  galleryAssistantPackage,
  listAssistantGallery,
  type GalleryLang,
} from '@okbot/agent';
import { fetchAssistantPackageFromUrl } from './storage/fetchGithubAssistant';
import type { IpcContext } from './ipc/context';
import { readRecentErrorLog } from './storage/errorLog';
import { isSquadOwnerId } from './storage/ids';
import { discoverModels, testModelConnection } from './modelProbe';
import { compressSessionNow } from './ipc/registerChat';
import { abortAllOwnerRuns } from './ipc/ownerRuns';

/**
 * Bot / squad / memory / skill / model-probe operations without a transport.
 * Electron IPC and the gateway RPC both call these, so the two stay one behavior.
 */
type Obj = Record<string, unknown>;

/** In-flight URL import abort (desktop Cancel + gateway best-effort). */
let urlImportAbort: AbortController | null = null;

export function cancelImportAssistantFromUrl(): boolean {
  if (!urlImportAbort) return false;
  urlImportAbort.abort();
  urlImportAbort = null;
  return true;
}


function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}

export function deleteOwner(ctx: IpcContext, ownerId: string, kind: 'bot' | 'squad'): true {
  const id = ownerId.trim();
  // Abort any in-flight runs so a late finally cannot resurrect the deleted dir.
  abortAllOwnerRuns(ctx.abortControllers, id);
  ctx.rejectPendingApprovalsForBot(id, kind === 'bot' ? '助手已删除' : '小队已删除');
  try {
    ctx.storage.clearPendingHitl(id);
  } catch {
    /* ignore */
  }
  if (kind === 'bot') ctx.storage.deleteBot(id);
  else ctx.storage.deleteSquad(id);
  return true;
}

export function buildPromptContext(
  ctx: IpcContext,
  payload: { botId: string; messageId: string },
): { text: string | null } {

    // payload.botId is owner id (bot or squad); channel name kept for compatibility.
    const ownerId = payload.botId;
    const settings = ctx.storage.getSettings();
    const toolPrefs = settings.tools ?? DEFAULT_TOOL_PREFERENCES;

    if (isSquadOwnerId(ownerId)) {
      const squad = ctx.storage.listSquads().find((s) => s.id === ownerId);
      if (!squad) {
        return { text: `小队不存在：${ownerId}` };
      }
      const bots = ctx.storage.listBots();
      const byId = new Map(bots.map((b) => [b.id, b]));
      const members = squad.members.map((m) => {
        const bot = byId.get(m.botId);
        return {
          botId: m.botId,
          name: bot?.name || m.botId,
          description: bot?.description || '',
          role: m.role,
        };
      });
      const squadSettings = settings.squad ?? DEFAULT_SQUAD_SETTINGS;
      const askToolNames = allocateAskToolNames(members);
      const summaryState = ctx.storage.readSessionSummary(squad.id);
      const sessionSummary = summaryState?.summary?.trim() || '';
      const coveredThroughId = summaryState?.coveredThroughId || null;
      // Mirror runSquadChat captain instructions (roster only; member AGENTS/skills/memories stay inside ask_* tools).
      const instructions = buildCaptainSquadInstructions({
        squadName: squad.name,
        squadDescription: squad.description,
        persona: squadSettings.captainPersona,
        playbook: squadSettings.playbook,
        members,
        askToolNames,
        prefs: toolPrefs,
        sessionSummary: sessionSummary || undefined,
        history: [] /* session owns history */,
        computerRouting: formatComputerRoutingSection({
          defaultComputerId: settings.defaultComputerId,
          computers: settings.computers,
        }),
      });
      const { items, found } = ctx.storage.getSessionItemsThroughMessage(
        squad.id,
        payload.messageId,
        { afterMessageId: coveredThroughId },
      );
      const text = formatSessionPromptContext({
        instructions,
        items,
        messageId: payload.messageId,
        found,
        coveredThroughId: coveredThroughId || undefined,
      });
      return { text };
    }

    const bots = ctx.storage.listBots();
    const bot = bots.find((b) => b.id === ownerId);
    if (!bot) {
      return { text: `助手不存在：${ownerId}` };
    }
    const agentsMd = ctx.storage.readAgentsMd(bot.id);
    const skillsText = ctx.storage.formatSkillsForPrompt(bot.id);
    const memoriesText = ctx.storage.formatMemoriesForPrompt(bot.id);
    const summaryState = ctx.storage.readSessionSummary(bot.id);
    const sessionSummary = summaryState?.summary?.trim() || '';
    const coveredThroughId = summaryState?.coveredThroughId || null;
    const instructions = buildAgentInstructions(
      bot.name,
      bot.description,
      [] /* session owns history */,
      toolPrefs,
      agentsMd,
      skillsText,
      memoriesText,
      sessionSummary || undefined,
      settings.instructions?.assistantRoleTemplate,
      false,
      formatComputerRoutingSection({
        defaultComputerId: settings.defaultComputerId,
        computers: settings.computers,
      }),
    );
    const { items, found } = ctx.storage.getSessionItemsThroughMessage(bot.id, payload.messageId, {
      afterMessageId: coveredThroughId,
    });
    const text = formatSessionPromptContext({
      instructions,
      items,
      messageId: payload.messageId,
      found,
      coveredThroughId: coveredThroughId || undefined,
    });
    return { text };
}

function galleryLang(v: unknown): GalleryLang {
  return v === 'en' ? 'en' : 'zh';
}

export function createEntityOps(ctx: IpcContext) {
  const s = ctx.storage;
  return {
    createBot: (a: Obj) =>
      s.createBot({ ...(a as Parameters<typeof s.createBot>[0]), name: typeof a.name === 'string' ? a.name : '新助手' }),
    updateBot: (a: Obj) => s.updateBot(str(a.id), obj(a.patch) as Parameters<typeof s.updateBot>[1]),
    finishBotOnboarding: (a: Obj) =>
      s.finishBotOnboarding(str(a.botId), obj(a.answers) as BotOnboardingAnswers),
    deleteBot: (a: Obj) => deleteOwner(ctx, str(a.id), 'bot'),
    createSquad: (a: Obj) => s.createSquad(a as unknown as CreateSquadInput),
    updateSquad: (a: Obj) =>
      s.updateSquad(str(a.id), obj(a.patch) as Parameters<typeof s.updateSquad>[1]),
    deleteSquad: (a: Obj) => deleteOwner(ctx, str(a.id), 'squad'),
    listAssistantGallery: (a: Obj) => listAssistantGallery(galleryLang(a.lang)),
    /** Install one built-in starter assistant (same path as `.okbot` import). */
    installGalleryAssistant: (a: Obj) => {
      const pkg = galleryAssistantPackage(str(a.id), galleryLang(a.lang));
      // Code, not text: the UI maps it to the user's language.
      if (!pkg) throw new Error('gallery_not_found');
      return s.installAssistantPackage(pkg);
    },
    /** Fetch a public GitHub / raw / .okbot URL and install via the same package path. */
    importAssistantFromUrl: async (a: Obj) => {
      const url = str(a.url).trim();
      if (!url) throw new Error('请输入 GitHub 地址或助手包链接');
      const overwrite = a.overwrite === true;
      // Replace any prior in-flight import controller.
      if (urlImportAbort) {
        try { urlImportAbort.abort(); } catch { /* ignore */ }
      }
      const ac = new AbortController();
      urlImportAbort = ac;
      try {
        const pkg = await fetchAssistantPackageFromUrl(url, { signal: ac.signal });
        const name = (pkg.manifest.name || '').trim();
        const existing = name
          ? s.listBots().filter((b) => b.name.trim() === name)
          : [];
        if (existing.length > 0 && !overwrite) {
          throw new Error(`assistant_name_exists:${name}`);
        }
        if (existing.length > 0 && overwrite) {
          for (const bot of existing) {
            deleteOwner(ctx, bot.id, 'bot');
          }
        }
        return s.installAssistantPackage(pkg);
      } finally {
        if (urlImportAbort === ac) urlImportAbort = null;
      }
    },
    cancelImportAssistantFromUrl: () => cancelImportAssistantFromUrl(),
    setChatUnread: (a: Obj) => {
      const ownerId = str(a.ownerId).trim();
      if (!ownerId) return false;
      s.assertKnownOwnerId(ownerId);
      s.setHasUnreadReply(ownerId, a.hasUnread === true);
      return true;
    },
    readAgentsMd: (a: Obj) => s.readAgentsMd(str(a.botId)),
    writeAgentsMd: (a: Obj) => {
      s.writeAgentsMd(str(a.botId), str(a.content));
      return true;
    },
    listBotMemories: (a: Obj) => s.listBotMemories(str(a.botId)),
    upsertBotMemory: (a: Obj) => {
      s.upsertMemory('bot', obj(a.entry) as unknown as MemoryEntry);
      return true;
    },
    deleteBotMemory: (a: Obj) => {
      s.deleteMemory('bot', str(a.botId), str(a.memoryId));
      return true;
    },
    listGlobalMemories: () => s.listGlobalMemories(),
    upsertGlobalMemory: (a: Obj) => {
      s.upsertMemory('global', obj(a.entry) as unknown as MemoryEntry);
      return true;
    },
    deleteGlobalMemory: (a: Obj) => {
      s.deleteMemory('global', '', str(a.memoryId));
      return true;
    },
    listBotSkills: (a: Obj) => s.listSkills(str(a.botId)),
    writeBotSkill: (a: Obj) => {
      s.writeSkill(str(a.botId), obj(a.skill) as unknown as BotSkill);
      return true;
    },
    deleteBotSkill: (a: Obj) => {
      s.assertKnownBotId(str(a.botId));
      s.deleteSkill(str(a.botId), str(a.slug));
      return true;
    },
    listGlobalAgentsSkills: () => s.listGlobalAgentsSkills(),
    searchMessages: (a: Obj) =>
      s.searchMessages(str(a.query), { limit: typeof a.limit === 'number' ? a.limit : undefined }),
    getLastRunTrace: (a: Obj) => {
      const ownerId = str(a.ownerId).trim();
      if (!ownerId) return { trace: null };
      s.assertKnownOwnerId(ownerId);
      return { trace: s.getLastRunTrace(ownerId) };
    },
    getPromptContext: (a: Obj) =>
      buildPromptContext(ctx, { botId: str(a.botId), messageId: str(a.messageId) }),
    getRecentErrorLog: (a: Obj) => {
      const limit = a.limit;
      const n = typeof limit === 'number' && limit > 0 ? Math.min(200, Math.floor(limit)) : 50;
      return { entries: readRecentErrorLog(s.root, n) };
    },
    clearModelBindingsForProvider: (a: Obj) => {
      const providerId = str(a.providerId).trim();
      if (!providerId) return { cleared: 0 };
      const removed = Array.isArray(a.removedModelIds)
        ? a.removedModelIds.filter((x): x is string => typeof x === 'string')
        : undefined;
      return { cleared: s.clearModelBindingsForProvider(providerId, removed) };
    },
    discoverModels: (a: Obj) => discoverModels(s.getSettings(), a),
    testModelConnection: (a: Obj) => testModelConnection(s.getSettings(), a),
    compressSessionNow: (a: Obj) =>
      compressSessionNow(ctx, {
        botId: str(a.botId) || undefined,
        squadId: str(a.squadId) || undefined,
        mode: a.mode === 'newTopic' ? 'newTopic' : 'compress',
      }),
    listScheduledJobs: () => s.listAllScheduledJobInfos(),
    manageScheduledJob: (a: Obj) => {
      const ownerId = str(a.ownerId).trim();
      const jobId = str(a.jobId).trim();
      const action = str(a.action).trim();
      if (!ownerId || !jobId) throw new Error('missing_owner_or_job');
      if (action !== 'pause' && action !== 'resume' && action !== 'delete') {
        throw new Error('invalid_action');
      }
      const summary = s.manageScheduledJobs(ownerId, { action, jobId });
      if (summary.startsWith('错误：')) throw new Error(summary.replace(/^错误：/, ''));
      return { ok: true as const, summary };
    },
  };
}

export type EntityOps = ReturnType<typeof createEntityOps>;
export type EntityOpName = keyof EntityOps;
