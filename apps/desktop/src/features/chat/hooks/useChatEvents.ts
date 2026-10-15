import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  plainTextFromMarkdown,
  stripThinkContent,
  type Bot,
  type ChatMessage,
  type Squad,
} from '@okbot/shared';
import { toast } from '../../../components/ui';
import { t, type UiLang } from '../../../i18n';
import { formatSystemError } from '../../../utils/formatSystemError';
import { windowIsFocused } from '../../../utils/systemNotify';
import { rememberReconciledLocalId } from '../../../utils/optimisticSend';
import { saveLastSelection } from '../../sidebar';
import {
  removeParallelTask,
  upsertParallelTask,
  type ParallelTask,
} from '../ParallelTasksStrip';
import type { Selection, ToolCard, TurnPhase } from '../../../types';
import { SQUAD_CAPTAIN_SPEAKER_ID } from '@okbot/shared';

export type ChatEventsDeps = {
  lang: UiLang;
  selectionRef: MutableRefObject<Selection>;
  streamingPreviewRef: MutableRefObject<Record<string, string>>;
  pendingOptimisticRef: MutableRefObject<Array<{ ownerId: string; localId: string }>>;
  reconciledLocalIdsRef: MutableRefObject<Set<string>>;
  sendsInFlightRef: MutableRefObject<Record<string, number>>;
  notifyUnfocusedRef: MutableRefObject<
    (ownerId: string, kind: 'reply' | 'approval', toolName?: string, eventId?: string) => void
  >;
  markSessionUnread: (ownerId: string, hasUnread: boolean) => void;
  setBots: Dispatch<SetStateAction<Bot[]>>;
  setSquads: Dispatch<SetStateAction<Squad[]>>;
  setSelection: Dispatch<SetStateAction<Selection>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setToolCardsByBot: Dispatch<SetStateAction<Record<string, ToolCard[]>>>;
  setBusyByBot: Dispatch<SetStateAction<Record<string, boolean>>>;
  setTurnPhaseByBot: Dispatch<SetStateAction<Record<string, TurnPhase>>>;
  setParallelTasksByOwner: Dispatch<SetStateAction<Record<string, ParallelTask[]>>>;
};

/**
 * Runtime chat event routing + rAF-coalesced stream flush.
 * Empty deps: refs/setters are stable enough; selection races use selectionRef.
 */
export function useChatEvents(deps: ChatEventsDeps): void {
  const {
    lang,
    selectionRef,
    streamingPreviewRef,
    pendingOptimisticRef,
    reconciledLocalIdsRef,
    sendsInFlightRef,
    notifyUnfocusedRef,
    markSessionUnread,
    setBots,
    setSquads,
    setSelection,
    setMessages,
    setToolCardsByBot,
    setBusyByBot,
    setTurnPhaseByBot,
    setParallelTasksByOwner,
  } = deps;

  useEffect(() => {
  type PendingStream = {
    raf: number | null;
    previewByBot: Record<string, string>;
    replyPhaseBots: Set<string>;
    messageDeltas: Record<string, string>;
  };
  const pending: PendingStream = {
    raf: null,
    previewByBot: {},
    replyPhaseBots: new Set(),
    messageDeltas: {},
  };

  const flushPendingStream = () => {
    if (pending.raf != null) {
      cancelAnimationFrame(pending.raf);
      pending.raf = null;
    }
    const previewByBot = pending.previewByBot;
    const replyPhaseBots = pending.replyPhaseBots;
    const messageDeltas = pending.messageDeltas;
    const previewIds = Object.keys(previewByBot);
    const deltaIds = Object.keys(messageDeltas);
    const hasPreview = previewIds.length > 0;
    const hasReply = replyPhaseBots.size > 0;
    const hasMessages = deltaIds.length > 0;
    if (!hasPreview && !hasReply && !hasMessages) return;

    pending.previewByBot = {};
    pending.replyPhaseBots = new Set();
    pending.messageDeltas = {};

    if (hasPreview) {
      setBots((prev) => {
        let changed = false;
        const next = prev.map((b) => {
          const md = previewByBot[b.id];
          if (md == null) return b;
          const text = plainTextFromMarkdown(stripThinkContent(md));
          if (b.lastReplyPreview === text) return b;
          changed = true;
          return { ...b, lastReplyPreview: text };
        });
        return changed ? next : prev;
      });
    }
    if (hasReply) {
      setTurnPhaseByBot((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const botId of replyPhaseBots) {
          if (next[botId] === 'replying') continue;
          next[botId] = 'replying';
          changed = true;
        }
        return changed ? next : prev;
      });
    }
    if (hasMessages) {
      setMessages((prev) => {
        let next: ChatMessage[] | null = null;
        for (const messageId of deltaIds) {
          const delta = messageDeltas[messageId];
          if (!delta) continue;
          const list: ChatMessage[] = next ?? prev;
          const idx = list.findIndex((m) => m.id === messageId);
          if (idx < 0) {
            let speakerBotId: string | undefined;
            const sel = selectionRef.current;
            if (sel?.kind === 'squad') {
              speakerBotId = SQUAD_CAPTAIN_SPEAKER_ID;
            }
            // Switch-back mid-stream: seed full preview, not only the latest delta chunk.
            const full =
              streamingPreviewRef.current[messageId] ||
              delta;
            next = [
              ...list,
              {
                id: messageId,
                role: 'assistant',
                content: full,
                createdAt: new Date().toISOString(),
                ...(speakerBotId ? { speakerBotId } : {}),
              },
            ];
          } else {
            if (!next) next = [...list];
            next[idx] = { ...next[idx], content: next[idx].content + delta };
          }
        }
        return next ?? prev;
      });
    }
  };

  const scheduleStreamFlush = () => {
    if (pending.raf != null) return;
    pending.raf = requestAnimationFrame(() => {
      pending.raf = null;
      flushPendingStream();
    });
  };

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshSeq = 0;
  const scheduleSessionsRefresh = () => {
    if (refreshTimer != null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const ticket = ++refreshSeq;
      void Promise.all([window.okbot.listBots(), window.okbot.listSquads()])
        .then(([nextBots, nextSquads]) => {
          if (ticket !== refreshSeq) return;
          setBots(nextBots);
          setSquads(nextSquads);
          const sel = selectionRef.current;
          if (!sel) return;
          const stillThere =
            sel.kind === 'bot'
              ? nextBots.some((b: { id: string }) => b.id === sel.id)
              : nextSquads.some((s: { id: string }) => s.id === sel.id);
          if (!stillThere) {
            setSelection(null);
            saveLastSelection(null);
          }
        })
        .catch((err) => {
          console.error('[okbot] session list refresh failed', err);
        });
    }, 120);
  };

  const off = window.okbot.onRuntimeEvent((event) => {
    // Other window (Electron or gateway) changed the shared ~/.okbot roster.
    if (event.type === 'sessions_changed') {
      scheduleSessionsRefresh();
      return;
    }

    const isActive =
      (selectionRef.current?.kind === 'bot' || selectionRef.current?.kind === 'squad') &&
      selectionRef.current.id === event.botId;

    // Hot-reload signal — catalog reloads on next turn; no transcript mutation.
    if (event.type === 'skills_changed') {
      return;
    }

    if (event.type === 'turn_started') {
      const clientTurnId = (event.clientTurnId || '').trim();
      const runId = (event.runId || '').trim();
      setParallelTasksByOwner((prev) => {
        const list = prev[event.botId] ?? [];
        const existing =
          (clientTurnId
            ? list.find((x) => x.clientTurnId === clientTurnId || x.id === clientTurnId)
            : undefined) ||
          (runId ? list.find((x) => x.runId === runId) : undefined);
        const id = existing?.id || clientTurnId || runId;
        if (!id) return prev;
        return {
          ...prev,
          [event.botId]: upsertParallelTask(list, {
            id,
            clientTurnId: clientTurnId || existing?.clientTurnId,
            runId: runId || existing?.runId,
            userMessageId: event.userMessageId || existing?.userMessageId,
            assistantMessageId: event.assistantMessageId || existing?.assistantMessageId,
            label: existing?.label || '…',
            status: existing?.status || 'running',
            startedAt: existing?.startedAt || Date.now(),
          }),
        };
      });
      return;
    }

    if (event.type === 'user_message') {
      const pendingIdx = pendingOptimisticRef.current.findIndex((p) => p.ownerId === event.botId);
      if (pendingIdx >= 0) {
        const pending = pendingOptimisticRef.current[pendingIdx]!;
        pendingOptimisticRef.current.splice(pendingIdx, 1);
        rememberReconciledLocalId(reconciledLocalIdsRef.current, pending.localId);
      }
      // HTTP/API turns have no local send in flight; still show Stop.
      setBusyByBot((prev) => (prev[event.botId] ? prev : { ...prev, [event.botId]: true }));
      setTurnPhaseByBot((prev) =>
        prev[event.botId] ? prev : { ...prev, [event.botId]: 'thinking' },
      );
      if (isActive) {
        setMessages((prev) => {
          const byId = prev.findIndex((m) => m.id === event.message.id);
          if (byId >= 0) {
            const next = [...prev];
            next[byId] = event.message;
            return next;
          }
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'user' && String(prev[i].id).startsWith('local_')) {
              rememberReconciledLocalId(reconciledLocalIdsRef.current, String(prev[i].id));
              const next = [...prev];
              next[i] = event.message;
              return next;
            }
          }
          return [...prev, event.message];
        });
      }
      // Keep parallel task labels/ids in sync when local_ bubbles become real ids.
      setParallelTasksByOwner((prev) => {
        const list = prev[event.botId] ?? [];
        if (!list.length) return prev;
        const runId = typeof (event as { runId?: string }).runId === 'string' ? (event as { runId?: string }).runId : '';
        let changed = false;
        const next = list.map((task) => {
          if (runId && task.runId === runId) {
            changed = true;
            return {
              ...task,
              userMessageId: event.message.id,
              label: (event.message.content || task.label).trim() || task.label,
            };
          }
          if (task.userMessageId && String(task.userMessageId).startsWith('local_')) {
            // FIFO: first local_ task without real id
            if (!changed) {
              changed = true;
              return {
                ...task,
                userMessageId: event.message.id,
                label: (event.message.content || task.label).trim() || task.label,
              };
            }
          }
          return task;
        });
        return changed ? { ...prev, [event.botId]: next } : prev;
      });
      return;
    }

    if (event.type === 'assistant_message') {
      // Full replace (incl. mesh onClearLiveText → empty): drop coalesced deltas so
      // a pending rAF flush cannot re-append pre-tool think-aloud / ask narration.
      delete pending.messageDeltas[event.message.id];
      const replaced = event.message.content || '';
      if (replaced.trim()) {
        streamingPreviewRef.current[event.message.id] = replaced;
      } else {
        delete streamingPreviewRef.current[event.message.id];
        delete pending.previewByBot[event.botId];
      }
      if (isActive) {
        setMessages((prev) => {
          const byId = prev.findIndex((m) => m.id === event.message.id);
          if (byId >= 0) {
            const next = [...prev];
            next[byId] = event.message;
            return next;
          }
          return [...prev, event.message];
        });
      }
      return;
    }

    if (event.type === 'tool_request') {
      // Flush any coalesced deltas before clearing pre-tool think-aloud.
      flushPendingStream();
      delete streamingPreviewRef.current[event.messageId];
      delete pending.messageDeltas[event.messageId];
      delete pending.previewByBot[event.botId];
      if (isActive) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === event.messageId);
          if (idx < 0 || !prev[idx].content) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], content: '' };
          return next;
        });
      }

      setToolCardsByBot((prev) => {
        const list = prev[event.botId] ?? [];
        if (list.some((c) => c.requestId === event.requestId)) return prev;
        return {
          ...prev,
          [event.botId]: [
            ...list,
            {
              requestId: event.requestId,
              messageId: event.messageId,
              toolName: event.toolName,
              arguments: event.arguments,
              status: 'pending',
            },
          ],
        };
      });
      setBusyByBot((prev) => ({ ...prev, [event.botId]: true }));
      setTurnPhaseByBot((prev) => ({ ...prev, [event.botId]: 'awaiting_approval' }));
      if (event.runId) {
        setParallelTasksByOwner((prev) => ({
          ...prev,
          [event.botId]: upsertParallelTask(prev[event.botId] ?? [], {
            id: event.runId!,
            runId: event.runId,
            assistantMessageId: event.messageId,
            status: 'awaiting_approval',
          }),
        }));
      }
      if (!isActive || !windowIsFocused()) markSessionUnread(event.botId, true);
      notifyUnfocusedRef.current(event.botId, 'approval', event.toolName, event.requestId || event.messageId);
      return;
    }
    if (event.type === 'tool_result') {
      setToolCardsByBot((prev) => ({
        ...prev,
        [event.botId]: (prev[event.botId] ?? []).map((c) =>
          c.requestId === event.requestId
            ? {
                ...c,
                status: event.approved ? 'approved' : 'denied',
                output: event.output,
              }
            : c,
        ),
      }));
      if (event.approved) {
        const phase: TurnPhase =
          event.toolName === 'run_shell' ? 'running_shell' : 'running_tool';
        setTurnPhaseByBot((prev) => ({ ...prev, [event.botId]: phase }));
      } else {
        setTurnPhaseByBot((prev) => ({ ...prev, [event.botId]: 'thinking' }));
      }
      if (event.runId) {
        setParallelTasksByOwner((prev) => ({
          ...prev,
          [event.botId]: upsertParallelTask(prev[event.botId] ?? [], {
            id: event.runId!,
            runId: event.runId,
            status: 'running',
          }),
        }));
      }
      return;
    }
    if (event.type === 'done' || event.type === 'error') {
      flushPendingStream();
      if (event.runId) {
        setParallelTasksByOwner((prev) => ({
          ...prev,
          [event.botId]: removeParallelTask(prev[event.botId] ?? [], { runId: event.runId }),
        }));
      }
      const inFlight = sendsInFlightRef.current[event.botId] || 0;
      // Parallel: one turn's done must not clear busy while other sends still await.
      if (inFlight === 0) {
        setBusyByBot((prev) => ({ ...prev, [event.botId]: false }));
        setTurnPhaseByBot((prev) => {
          if (!(event.botId in prev)) return prev;
          const next = { ...prev };
          delete next[event.botId];
          return next;
        });
      } else {
        // Final content is on screen but chatStart IPC is still wrapping up
        // (persist, AGENTS/skills/memory refresh). Keep busy via sendsInFlight;
        // show wrapping_up instead of lingering on replying.
        // Skip aborted done / inFlight>1 so a finished sibling does not clobber
        // another in-flight turn's thinking/replying phase.
        const isAbortedDone = event.type === 'done' && !!event.aborted;
        if (!isAbortedDone && inFlight === 1) {
          setTurnPhaseByBot((prev) => ({ ...prev, [event.botId]: 'wrapping_up' }));
        }
      }
      if ((event.type === 'done' && !event.aborted) || event.type === 'error') {
        if (!isActive || !windowIsFocused()) {
          markSessionUnread(event.botId, true);
        } else {
          // This window shows the chat in front. Another window may mark it unread
          // for the same event; write "read" a moment later so the viewer wins.
          const ownerId = event.botId;
          window.setTimeout(() => {
            if (windowIsFocused()) markSessionUnread(ownerId, false);
          }, 400);
        }
        if (event.type === 'done') {
          notifyUnfocusedRef.current(event.botId, 'reply', undefined, event.messageId);
        }
      }
    }

    if (event.type === 'delta') {
      const soFar = (streamingPreviewRef.current[event.messageId] || '') + event.delta;
      streamingPreviewRef.current[event.messageId] = soFar;
      pending.previewByBot[event.botId] = soFar;
      pending.replyPhaseBots.add(event.botId);
      if (isActive) {
        pending.messageDeltas[event.messageId] =
          (pending.messageDeltas[event.messageId] || '') + event.delta;
      }
      scheduleStreamFlush();
      return;
    } else if (event.type === 'done') {
      delete streamingPreviewRef.current[event.messageId];
      const text = plainTextFromMarkdown(stripThinkContent(event.content || ''));
      setBots((prev) =>
        prev.map((b) =>
          b.id === event.botId
            ? {
                ...b,
                lastReplyPreview: text,
                ...(event.aborted ? {} : { onboardingComplete: true }),
              }
            : b,
        ),
      );
    } else if (event.type === 'error') {
      delete streamingPreviewRef.current[event.messageId];
      toast.error(formatSystemError(event.error));
    }

    // Message stream UI only for the active bot; inactive bots keep working state above.
    if (!isActive) return;
    if (event.type !== 'done' && event.type !== 'error') return;

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === event.messageId);
      if (event.type === 'done' || event.type === 'error') {
        if (idx < 0) return prev;
        const next = [...prev];
        const prevContent = next[idx].content || '';
        let nextContent =
          event.type === 'done' ? event.content || '' : prevContent || `${t(lang, 'errorPrefix')}${event.error}`;
        // Stable display: never flash to a shorter "final-only" string while live text
        // already shows the full streamed reply (reload used to fight this too).
        if (
          event.type === 'done' &&
          prevContent.trim() &&
          nextContent.trim() &&
          nextContent.length < prevContent.length
        ) {
          nextContent = prevContent;
        }
        next[idx] = {
          ...next[idx],
          content: nextContent,
          ...(event.type === 'done' && event.usage ? { usage: event.usage } : {}),
          ...(event.type === 'done' && event.trace ? { trace: event.trace } : {}),
        };
        return next;
      }
      return prev;
    });
  });
  return () => {
    off();
    if (refreshTimer != null) clearTimeout(refreshTimer);
    if (pending.raf != null) {
      cancelAnimationFrame(pending.raf);
      pending.raf = null;
    }
  };
  }, []);
}
