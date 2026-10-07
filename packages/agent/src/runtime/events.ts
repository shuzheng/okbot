import type { RuntimeEvent } from '@okbot/shared';

/**
 * Encode one RuntimeEvent as an SSE frame (Gateway + local HTTP API).
 * event: <type> + data: full JSON RuntimeEvent — same shape desktop IPC uses.
 */
export function encodeRuntimeEventSse(event: RuntimeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse SSE blocks into RuntimeEvent objects (ignores comments / incomplete).
 * Shared by gateway web bridge and tests — one decoder for desktop + HTTP.
 */
export function parseRuntimeEventSseBlocks(buffer: string): {
  events: RuntimeEvent[];
  rest: string;
} {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() || '';
  const events: RuntimeEvent[] = [];
  for (const block of parts) {
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as RuntimeEvent;
      if (parsed && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string') {
        events.push(parsed);
      }
    } catch {
      /* ignore malformed */
    }
  }
  return { events, rest };
}

/** Terminal event types that end an SSE chat turn subscription. */
export function isRuntimeEventTurnTerminal(event: RuntimeEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}

/**
 * SSE subscription for a newly started turn.
 * Bind on `turn_started` (optionally matching `clientTurnId`) or a `user_message`
 * that already carries `runId`, then only forward events with that runId.
 * Callers should end the stream when their own startChatTurn settles — not on
 * the first done/error (sibling terminals must not close this SSE).
 */
export type SseTurnGate = {
  runId: string | null;
  /** When set, only bind to turn_started with this clientTurnId. */
  clientTurnId?: string;
};

export function acceptRuntimeEventForSseTurn(
  gate: SseTurnGate,
  event: RuntimeEvent,
): boolean {
  if (event.type === 'skills_changed' || event.type === 'sessions_changed') {
    return false;
  }

  if (!gate.runId) {
    if (event.type === 'turn_started') {
      const want = (gate.clientTurnId || '').trim();
      const got = (event.clientTurnId || '').trim();
      if (want && want !== got) return false;
      gate.runId = event.runId;
      return true;
    }
    if (event.type === 'user_message') {
      const rid = typeof event.runId === 'string' ? event.runId.trim() : '';
      if (!rid) return false;
      // user_message has no clientTurnId; require turn_started when disambiguating.
      if ((gate.clientTurnId || '').trim()) return false;
      gate.runId = rid;
      return true;
    }
    return false;
  }

  const evRun =
    'runId' in event && typeof (event as { runId?: unknown }).runId === 'string'
      ? String((event as { runId: string }).runId).trim()
      : '';
  if (!evRun) return false;
  return evRun === gate.runId;
}
