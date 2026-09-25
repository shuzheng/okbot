import { ipcMain } from 'electron';
import {
  IpcChannels,
  DEFAULT_TOOL_PREFERENCES,
  DEFAULT_SQUAD_SETTINGS,
  normalizeApiFormat,
  type ApiFormat,
  type AppSettings,
  type CatalogModel,
  redactSensitiveText,
} from '@okbot/shared';
import {
  allocateAskToolNames,
  buildAgentInstructions,
  buildCaptainSquadInstructions,
  formatSessionPromptContext,
} from '@okbot/agent';
import type { IpcContext } from './context';
import { readRecentErrorLog } from '../storage/errorLog';
import { isSquadOwnerId } from '../storage/ids';

export function registerEntityIpc(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.getBootstrap, () => {
    const settings = ctx.storage.getSettings();
    const settingsLoadWarning = ctx.storage.takeSettingsLoadWarning() ?? undefined;
    return {
      bots: ctx.storage.withReplyPreviews(ctx.storage.listBots()),
      squads: ctx.storage.listSquads(),
      settings,
      hardwareAccelerationActive: ctx.hardwareAccelerationActive,
      dataDir: ctx.storage.root,
      ...(settingsLoadWarning ? { settingsLoadWarning } : {}),
      ...ctx.snapshotActiveRuns(),
    };
  });

  ipcMain.handle(IpcChannels.listBots, () => ctx.storage.withReplyPreviews(ctx.storage.listBots()));
  ipcMain.handle(IpcChannels.createBot, (_e, input) => ctx.storage.createBot(input ?? { name: '新助手' }));
  ipcMain.handle(IpcChannels.updateBot, (_e, id: string, patch) => ctx.storage.updateBot(id, patch));
  ipcMain.handle(IpcChannels.finishBotOnboarding, (_e, botId: string, answers) =>
    ctx.storage.finishBotOnboarding(botId, answers),
  );
  ipcMain.handle(IpcChannels.deleteBot, (_e, id: string) => {
    const botId = (id || '').trim();
    // Abort any in-flight run so a late finally cannot resurrect the deleted dir.
    ctx.abortControllers.get(botId)?.abort();
    ctx.abortControllers.delete(botId);
    ctx.rejectPendingApprovalsForBot(botId, '助手已删除');
    try {
      ctx.storage.clearPendingHitl(botId);
    } catch {
      /* ignore */
    }
    ctx.storage.deleteBot(botId);
    return true;
  });

  ipcMain.handle(IpcChannels.readAgentsMd, (_e, botId: string) => ctx.storage.readAgentsMd(botId));
  ipcMain.handle(IpcChannels.writeAgentsMd, (_e, botId: string, content: string) => {
    ctx.storage.writeAgentsMd(botId, typeof content === 'string' ? content : '');
    return true;
  });
  ipcMain.handle(IpcChannels.listBotMemories, (_e, botId: string) => ctx.storage.listBotMemories(botId));
  ipcMain.handle(IpcChannels.upsertBotMemory, (_e, entry) => {
    ctx.storage.upsertMemory('bot', entry);
    return true;
  });
  ipcMain.handle(IpcChannels.deleteBotMemory, (_e, payload: { botId: string; memoryId: string }) => {
    ctx.storage.deleteMemory('bot', payload.botId, payload.memoryId);
    return true;
  });
  ipcMain.handle(IpcChannels.listGlobalMemories, () => ctx.storage.listGlobalMemories());
  ipcMain.handle(IpcChannels.upsertGlobalMemory, (_e, entry) => {
    ctx.storage.upsertMemory('global', entry);
    return true;
  });
  ipcMain.handle(IpcChannels.deleteGlobalMemory, (_e, memoryId: string) => {
    ctx.storage.deleteMemory('global', '', typeof memoryId === 'string' ? memoryId : '');
    return true;
  });
  ipcMain.handle(IpcChannels.listBotSkills, (_e, botId: string) => ctx.storage.listSkills(botId));
  ipcMain.handle(IpcChannels.writeBotSkill, (_e, botId: string, skill) => {
    ctx.storage.writeSkill(botId, skill);
    return true;
  });
  ipcMain.handle(IpcChannels.deleteBotSkill, (_e, payload: { botId: string; slug: string }) => {
    ctx.storage.assertKnownBotId(payload?.botId);
    ctx.storage.deleteSkill(payload.botId, payload.slug);
    return true;
  });
  ipcMain.handle(IpcChannels.listGlobalAgentsSkills, () => ctx.storage.listGlobalAgentsSkills());

  ipcMain.handle(IpcChannels.listSquads, () => ctx.storage.listSquads());
  ipcMain.handle(IpcChannels.createSquad, (_e, input) => ctx.storage.createSquad(input));
  ipcMain.handle(IpcChannels.updateSquad, (_e, id: string, patch) => ctx.storage.updateSquad(id, patch));
  ipcMain.handle(IpcChannels.deleteSquad, (_e, id: string) => {
    const squadId = (id || '').trim();
    ctx.abortControllers.get(squadId)?.abort();
    ctx.abortControllers.delete(squadId);
    ctx.rejectPendingApprovalsForBot(squadId, '小队已删除');
    try {
      ctx.storage.clearPendingHitl(squadId);
    } catch {
      /* ignore */
    }
    ctx.storage.deleteSquad(squadId);
    return true;
  });
  ipcMain.handle(
    IpcChannels.setChatUnread,
    (_e, payload: { ownerId?: string; hasUnread?: boolean }) => {
      const ownerId = (payload?.ownerId || '').trim();
      if (!ownerId) return false;
      ctx.storage.assertKnownOwnerId(ownerId);
      ctx.storage.setHasUnreadReply(ownerId, payload?.hasUnread === true);
      return true;
    },
  );

  ipcMain.handle(IpcChannels.getSettings, () => ctx.storage.getSettings());
  ipcMain.handle(IpcChannels.getUsageStats, () => ctx.storage.getUsageStats());
  ipcMain.handle(IpcChannels.saveSettings, (_e, settings: AppSettings) => {
    const prev = ctx.storage.getSettings();
    const saved = ctx.storage.saveSettings(settings);
    ctx.applyTheme(saved.theme);
    if (prev.autoUpdate !== saved.autoUpdate) {
      ctx.onAutoUpdatePreferenceChanged?.(saved.autoUpdate !== false);
    }
    return saved;
  });

  ipcMain.handle(
    IpcChannels.discoverModels,
    async (
      _e,
      payload: { baseURL?: string; apiKey?: string },
    ): Promise<{ ok: boolean; models?: CatalogModel[]; error?: string }> => {
      const baseURL = (payload?.baseURL || '').trim().replace(/\/$/, '');
      // Match chat auth: trim; if user pasted "Bearer xxx", don't double-prefix.
      let apiKey = (payload?.apiKey || '').trim();
      if (/^bearer\s+/i.test(apiKey)) {
        apiKey = apiKey.replace(/^bearer\s+/i, '').trim();
      }
      if (!baseURL) return { ok: false, error: '请先填写 BaseURL' };
      if (!apiKey) return { ok: false, error: '请先填写 API Key' };
      const url = `${baseURL}/models`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const hint =
            res.status === 401 || res.status === 403
              ? '（API Key 无效或无权限，请核对设置里的密钥是否与可正常对话的一致）'
              : '';
          return {
            ok: false,
            error: `拉取模型失败 HTTP ${res.status}${hint}${body ? `: ${body.slice(0, 200)}` : ''}`,
          };
        }
        const json = (await res.json()) as { data?: Array<{ id?: string; object?: string }> };
        const rows = Array.isArray(json?.data) ? json.data : [];
        const seen = new Set<string>();
        const models: CatalogModel[] = [];
        for (const row of rows) {
          const id = typeof row?.id === 'string' ? row.id.trim() : '';
          if (!id || seen.has(id)) continue;
          seen.add(id);
          models.push({
            id,
            name: id,
            contextWindow: 128_000,
            maxTokens: null,
            enabled: true,
          });
        }
        if (!models.length) {
          return { ok: false, error: '接口未返回可用模型，请手动添加' };
        }
        return { ok: true, models };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `拉取模型失败：${msg}` };
      }
    },
  );

  ipcMain.handle(
    IpcChannels.testModelConnection,
    async (
      _e,
      payload: {
        baseURL?: string;
        apiKey?: string;
        apiFormat?: ApiFormat | string;
        modelId?: string;
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      const baseURL = (payload?.baseURL || '').trim().replace(/\/$/, '');
      let apiKey = (payload?.apiKey || '').trim();
      if (/^bearer\s+/i.test(apiKey)) {
        apiKey = apiKey.replace(/^bearer\s+/i, '').trim();
      }
      const modelId = (payload?.modelId || '').trim();
      const apiFormat = normalizeApiFormat(payload?.apiFormat);
      if (!baseURL) return { ok: false, error: '请先填写 BaseURL' };
      if (!apiKey) return { ok: false, error: '请先填写 API Key' };
      if (!modelId) return { ok: false, error: '缺少模型 ID' };

      const redact = (msg: string): string => redactSensitiveText(msg, apiKey).slice(0, 240);

      try {
        if (apiFormat === 'responses') {
          const url = `${baseURL}/responses`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              model: modelId,
              input: 'ping',
              max_output_tokens: 1,
            }),
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            const hint =
              res.status === 401 || res.status === 403
                ? '（API Key 无效或无权限）'
                : res.status === 404
                  ? '（路径或模型不存在，请核对 BaseURL / 模型 ID / API 格式）'
                  : '';
            return {
              ok: false,
              error: redact(`连通失败 HTTP ${res.status}${hint}${body ? `: ${body}` : ''}`),
            };
          }
          return { ok: true };
        }

        const url = `${baseURL}/chat/completions`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            stream: false,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const hint =
            res.status === 401 || res.status === 403
              ? '（API Key 无效或无权限）'
              : res.status === 404
                ? '（路径或模型不存在，请核对 BaseURL / 模型 ID / API 格式）'
                : '';
          return {
            ok: false,
            error: redact(`连通失败 HTTP ${res.status}${hint}${body ? `: ${body}` : ''}`),
          };
        }
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: redact(`连通失败：${msg}`) };
      }
    },
  );

  ipcMain.handle(IpcChannels.getMessages, (_e, botId: string) => ctx.storage.getMessages(botId));
  ipcMain.handle(
    IpcChannels.getMessagesPage,
    (
      _e,
      payload: { botId: string; limit?: number; beforeMessageId?: string | null },
    ) =>
      ctx.storage.getMessagesPage(payload.botId, {
        limit: payload.limit,
        beforeMessageId: payload.beforeMessageId,
      }),
  );
  ipcMain.handle(
    IpcChannels.searchMessages,
    (_e, payload: { query: string; limit?: number }) =>
      ctx.storage.searchMessages(payload?.query ?? '', { limit: payload?.limit }),
  );

  ipcMain.handle(
    IpcChannels.getLastRunTrace,
    (_e, payload: { ownerId: string }) => {
      const ownerId = (payload?.ownerId || '').trim();
      if (!ownerId) return { trace: null };
      ctx.storage.assertKnownOwnerId(ownerId);
      return { trace: ctx.storage.getLastRunTrace(ownerId) };
    },
  );

  ipcMain.handle(
    IpcChannels.getPromptContext,
    (_e, payload: { botId: string; messageId: string }) => {
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
    },
  );

  ipcMain.handle(IpcChannels.getRecentErrorLog, (_e, limit?: number) => {
    const n = typeof limit === 'number' && limit > 0 ? Math.min(200, Math.floor(limit)) : 50;
    return { entries: readRecentErrorLog(ctx.storage.root, n) };
  });

  ipcMain.handle(
    IpcChannels.clearModelBindingsForProvider,
    (_e, payload: { providerId: string; removedModelIds?: string[] }) => {
      const providerId = typeof payload?.providerId === 'string' ? payload.providerId.trim() : '';
      if (!providerId) return { cleared: 0 };
      const removed = Array.isArray(payload?.removedModelIds)
        ? payload.removedModelIds.filter((x): x is string => typeof x === 'string')
        : undefined;
      const cleared = ctx.storage.clearModelBindingsForProvider(providerId, removed);
      return { cleared };
    },
  );
}
