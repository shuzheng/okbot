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
 * A steer aborts the previous run first; that run's done/error is delivered
 * before this turn's user_message. Ignore those (and any other pre-turn events)
 * until user_message, then treat the next done/error as this turn's end.
 */
export function acceptRuntimeEventForSseTurn(
  gate: { seenUserMessage: boolean },
  event: RuntimeEvent,
): boolean {
  if (!gate.seenUserMessage) {
    if (event.type !== "user_message") return false;
    gate.seenUserMessage = true;
  }
  return true;
}
