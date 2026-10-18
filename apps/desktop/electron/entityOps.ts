import {
  DEFAULT_TOOL_PREFERENCES,
  DEFAULT_SQUAD_SETTINGS,
  resolveModelConfig,
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
  resolveImageCapability,
  meshAskToolAllowed,
  type GalleryLang,
} from '@okbot/agent';
import { fetchAssistantPackageFromUrl } from './storage/fetchGithubAssistant';
import type { IpcContext } from './ipc/context';
import { readRecentErrorLog } from './storage/errorLog';
import { isSquadOwnerId } from './storage/ids';
import { discoverModels, testModelConnection } from './modelProbe';
import { compressSessionNow, startChatTurn } from './ipc/registerChat';
import { onboardingSkipGreetingText } from './ipc/chat/turnContext';
import { abortAllOwnerRuns } from './ipc/ownerRuns';
import { buildMeshPeerSpecs } from './ipc/chatTurnHelpers';
import {
  seedBotDescriptionAfterOnboarding,
  didOwnerNameChange,
  refreshOwnerDescriptionAfterRename,
} from './contextMaterials';

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
  if (kind === 'bot') {
    ctx.storage.deleteBot(id);
  } else {
    ctx.storage.deleteSquad(id);
  }
  try {
    const settings = ctx.storage.getSettings();
    let next = settings;
    let changed = false;
    if (kind === 'bot' && settings.defaultAssistantId === id) {
      next = { ...next, defaultAssistantId: '' };
      changed = true;
    }
    if ((settings.pinnedOwnerIds || []).includes(id)) {
      next = {
        ...next,
        pinnedOwnerIds: (next.pinnedOwnerIds || []).filter((x) => x !== id),
      };
      changed = true;
    }
    if ((settings.hiddenOwnerIds || []).includes(id)) {
      next = {
        ...next,
        hiddenOwnerIds: (next.hiddenOwnerIds || []).filter((x) => x !== id),
      };
      changed = true;
    }
    const membership = { ...(next.ownerGroupMembership || {}) };
    if (id in membership) {
      delete membership[id];
      next = { ...next, ownerGroupMembership: membership };
      changed = true;
    }
    if (changed) ctx.storage.saveSettings(next);
  } catch (err) {
    console.error('[okbot] clear defaultAssistantId/pinnedOwnerIds/hiddenOwnerIds/ownerGroupMembership on delete failed', err);
  }
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
      const modelConfig = resolveModelConfig(settings.model, {
        providerId: squad.providerId,
        modelId: squad.modelId,
      });
      const imageCapable =
        resolveImageCapability({
          baseURL: modelConfig.baseURL,
          apiKey: modelConfig.apiKey,
          catalogModelIds: modelConfig.providerModelIds,
          providerName: modelConfig.providerName,
        }) != null;
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
        computerRouting: formatComputerRoutingSection(
          {
            defaultComputerId: settings.defaultComputerId,
            computers: settings.computers,
          },
          { mentionGenerateImage: toolPrefs.generate_image?.enabled === true },
        ),
        imageCapable,
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
    const soulMd = ctx.storage.readSoulMd(bot.id);
    const skillsText = ctx.storage.formatSkillsForPrompt(bot.id);
    const memoriesText = ctx.storage.formatMemoriesForPrompt(bot.id);
    const summaryState = ctx.storage.readSessionSummary(bot.id);
    const sessionSummary = summaryState?.summary?.trim() || '';
    const coveredThroughId = summaryState?.coveredThroughId || null;
    const modelConfig = resolveModelConfig(settings.model, {
      providerId: bot.providerId,
      modelId: bot.modelId,
    });
    const imageCapable =
      resolveImageCapability({
        baseURL: modelConfig.baseURL,
        apiKey: modelConfig.apiKey,
        catalogModelIds: modelConfig.providerModelIds,
        providerName: modelConfig.providerName,
      }) != null;
    const meshPeers = buildMeshPeerSpecs(ctx.storage, bot.id);
    const instructions = buildAgentInstructions(
      bot.name,
      bot.description,
      [] /* session owns history */,
      toolPrefs,
      soulMd,
      skillsText,
      memoriesText,
      sessionSummary || undefined,
      settings.instructions?.assistantRoleTemplate,
      false,
      formatComputerRoutingSection(
        {
          defaultComputerId: settings.defaultComputerId,
          computers: settings.computers,
        },
        { mentionGenerateImage: toolPrefs.generate_image?.enabled === true },
      ),
      imageCapable,
      meshPeers.map((p) => ({ id: p.id, name: p.name, description: p.description })),
      meshPeers.length > 0 && meshAskToolAllowed(),
      settings.defaultAssistantId === bot.id,
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
    updateBot: (a: Obj) => {
      const id = str(a.id);
      const patch = obj(a.patch) as Parameters<typeof s.updateBot>[1];
      const prev = s.listBots().find((b) => b.id === id);
      const nameChanged = prev ? didOwnerNameChange(prev.name, patch.name) : false;
      const updated = s.updateBot(id, patch);
      if (nameChanged) {
        void refreshOwnerDescriptionAfterRename({
          storage: s,
          ownerKind: 'bot',
          ownerId: id,
        }).catch((err) => {
          console.error('[okbot] post-rename description refresh failed', id, err);
        });
      }
      return updated;
    },
    finishBotOnboarding: (a: Obj) => {
      const answers = obj(a.answers) as BotOnboardingAnswers;
      const bot = s.finishBotOnboarding(str(a.botId), answers);
      // Immediate description seed (name + onboarding + SOUL); do not wait for turn throttle.
      void seedBotDescriptionAfterOnboarding({
        storage: s,
        botId: bot.id,
        answers,
      }).catch((err) => {
        console.error('[okbot] post-onboarding description seed failed', err);
      });
      // Skip / empty answers: quiet model turn asks scope + collaboration prefs (no visible user bubble).
      const skipped =
        !(answers.scenarioLabel || '').trim() && !(answers.howLabel || '').trim();
      if (skipped) {
        let hasMessages = false;
        try {
          hasMessages = s.getMessages(bot.id).some((m) => m.role === 'user' || m.role === 'assistant');
        } catch {
          hasMessages = false;
        }
        if (!hasMessages) {
          // Headless/gateway has no Electron locale — zh|en from settings, else zh.
          const rawLang = s.getSettings().language;
          const lang = rawLang === 'en' ? 'en' : 'zh';
          const text = onboardingSkipGreetingText(lang);
          void startChatTurn(ctx, {
            botId: bot.id,
            text,
            origin: 'onboarding_skip',
          }).catch((err) => {
            console.error('[okbot] onboarding-skip greeting turn failed', err);
          });
        }
      }
      return bot;
    },
    deleteBot: (a: Obj) => deleteOwner(ctx, str(a.id), 'bot'),
    createSquad: (a: Obj) => s.createSquad(a as unknown as CreateSquadInput),
    updateSquad: (a: Obj) => {
      const id = str(a.id);
      const patch = obj(a.patch) as Parameters<typeof s.updateSquad>[1];
      const prev = s.listSquads().find((sq) => sq.id === id);
      const nameChanged = prev ? didOwnerNameChange(prev.name, patch.name) : false;
      const updated = s.updateSquad(id, patch);
      if (nameChanged) {
        void refreshOwnerDescriptionAfterRename({
          storage: s,
          ownerKind: 'squad',
          ownerId: id,
        }).catch((err) => {
          console.error('[okbot] post-rename description refresh failed', id, err);
        });
      }
      return updated;
    },
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
    readSoulMd: (a: Obj) => s.readSoulMd(str(a.botId)),
    writeSoulMd: (a: Obj) => {
      s.writeSoulMd(str(a.botId), str(a.content));
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
