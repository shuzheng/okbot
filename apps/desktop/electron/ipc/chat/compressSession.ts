import { createId, resolveModelConfig } from '@okbot/shared';
import {
  ensureSessionCompressed,
} from '../../storage/sessionCompression';
import {
  ownerHasRuns,
  registerOwnerRun,
  unregisterOwnerRun,
  withOwnerMaintenanceLock,
} from '../ownerRuns';
import type { TurnContext } from './turnContext';

/**
 * Manual Summary+Buffer: bypass ratio threshold.
 * mode=compress → keep recent buffer per settings; mode=newTopic → cover all prior (keep=0).
 * UI transcript (session.jsonl) is never trimmed. Disabled while owner is streaming.
 */
export async function compressSessionNow(
  ctx: TurnContext,
  payload: { botId?: string; squadId?: string; mode: 'compress' | 'newTopic' },
): Promise<{
  ok: boolean;
  didCompress?: boolean;
  coveredThroughId?: string | null;
  error?: string;
}> {
  const mode = payload?.mode === 'newTopic' ? 'newTopic' : 'compress';
  const botId = typeof payload?.botId === 'string' ? payload.botId.trim() : '';
  const squadId = typeof payload?.squadId === 'string' ? payload.squadId.trim() : '';
  if ((botId && squadId) || (!botId && !squadId)) {
    return { ok: false, error: 'invalid_owner' };
  }

  const ownerId = botId || squadId;
  if (ownerHasRuns(ctx.abortControllers, ownerId)) {
    return { ok: false, error: 'busy' };
  }

  const settings = ctx.storage.getSettings();
  let modelConfig;
  let staticText: string;

  if (botId) {
    const bot = ctx.storage.listBots().find((b) => b.id === botId);
    if (!bot) return { ok: false, error: 'not_found' };
    modelConfig = resolveModelConfig(settings.model, {
      providerId: bot.providerId,
      modelId: bot.modelId,
    });
    const soulMd = ctx.storage.readSoulMd(bot.id);
    const skillsText = ctx.storage.formatSkillsForPrompt(bot.id);
    const memoriesText = ctx.storage.formatMemoriesForPrompt(bot.id);
    staticText = [soulMd, skillsText, memoriesText, bot.name, bot.description]
      .filter(Boolean)
      .join('\n');
  } else {
    const squad = ctx.storage.listSquads().find((s) => s.id === squadId);
    if (!squad) return { ok: false, error: 'not_found' };
    modelConfig = resolveModelConfig(settings.model, {
      providerId: squad.providerId,
      modelId: squad.modelId,
    });
    const bots = ctx.storage.listBots();
    const rosterText = squad.members
      .map((m) => {
        const b = bots.find((x) => x.id === m.botId);
        return b ? `${b.name}（${m.role || '成员'}）` : '';
      })
      .filter(Boolean)
      .join('、');
    staticText = [
      squad.name,
      squad.description,
      settings.squad?.captainPersona,
      settings.squad?.playbook,
      rosterText,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const prior = ctx.storage
    .getMessages(ownerId)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => !m.meshExchange)
    .filter((m) => Boolean(m.content?.trim()));

  if (!prior.length) {
    return { ok: true, didCompress: false, coveredThroughId: null };
  }

  const controller = new AbortController();
  const compressRunId = createId('run');
  // Register so chatStart/chatAbort treat compress as busy.
  registerOwnerRun(ctx.abortControllers, ownerId, compressRunId, controller);
  try {
    const { summaryState, didCompress } = await withOwnerMaintenanceLock(ownerId, () =>
      ensureSessionCompressed({
        storage: ctx.storage,
        ownerId,
        model: modelConfig,
        contextCompression: settings.contextCompression,
        staticText,
        prior,
        sessionRows: ctx.storage.listSessionBudgetRows(ownerId),
        signal: controller.signal,
        force: mode,
      }),
    );
    return {
      ok: true,
      didCompress,
      coveredThroughId: summaryState?.coveredThroughId ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[okbot] compressSessionNow failed', err);
    return { ok: false, error: msg || 'compress_failed' };
  } finally {
    unregisterOwnerRun(ctx.abortControllers, ownerId, compressRunId, controller);
  }
}
