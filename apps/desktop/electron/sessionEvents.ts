import type { RuntimeEvent } from '@okbot/shared';

/**
 * Roster pings are not part of a chat turn.
 * The per-request chat SSE ends on done/error and is filtered to one owner,
 * so session-list changes go out on the long-lived /v1/events stream instead.
 */
export function runtimeEventChannel(event: RuntimeEvent): 'sessions' | 'turn' {
  return event.type === 'sessions_changed' ? 'sessions' : 'turn';
}
