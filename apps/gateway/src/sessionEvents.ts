import type { RuntimeEvent } from '@okbot/shared';

export type RuntimeEventSink = 'sessions' | 'turn';

/**
 * Roster / gateway-settings pings are not part of a chat turn.
 * Per-request chat SSE is filtered to one owner/run and ends when that turn
 * settles, so session-list and settings changes go out on the long-lived
 * GET /v1/events stream (`sessions` sink).
 *
 * Turn events also fan out to `sessions` so remote attach / WebUI clients
 * receive the same RuntimeEvent stream the gateway-owner Electron gets over
 * IPC. Without that, owner→attach chat sync is one-way (attach→owner still
 * worked because the owner listens on IPC).
 */
export function runtimeEventSinks(event: RuntimeEvent): RuntimeEventSink[] {
  if (event.type === 'sessions_changed' || event.type === 'settings_changed') {
    return ['sessions'];
  }
  return ['turn', 'sessions'];
}

/** Primary channel for the event (chat SSE vs roster stream). */
export function runtimeEventChannel(event: RuntimeEvent): 'sessions' | 'turn' {
  return runtimeEventSinks(event)[0]!;
}
