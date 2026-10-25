import {
  DEFAULT_GATEWAY_HTTP_API_PORT,
} from '@okbot/shared';

export function keptNumber(raw: string, previous: number): number {
  const trimmed = raw.trim();
  if (!trimmed) return previous;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : previous;
}

export function gatewayWebUiUrl(portRaw: string, _token?: string): string {
  const n = Number(portRaw);
  const port = Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : DEFAULT_GATEWAY_HTTP_API_PORT;
  // Login sets an HttpOnly cookie. Never put the access token in the address bar.
  return `http://127.0.0.1:${port}/`;
}

/** Token the running server checks. Gateway bootstrap blanks it, so attached windows use a separate call. */
export async function readSavedGatewayToken(): Promise<string> {
  const bridge = window.okbot as { getGatewayAccessToken?: () => Promise<string> };
  if (typeof bridge.getGatewayAccessToken === 'function') {
    const live = await bridge.getGatewayAccessToken();
    return typeof live === 'string' ? live : '';
  }
  const saved = await window.okbot.getSettings();
  return saved.gatewayHttpApi?.token || '';
}

/** Super-admin token for the owning gateway (desktop IPC). Blank for access-only / remote clients. */
export async function readSavedGatewayAdminToken(): Promise<string> {
  const bridge = window.okbot as { getGatewayAdminToken?: () => Promise<string> };
  if (typeof bridge.getGatewayAdminToken === 'function') {
    const live = await bridge.getGatewayAdminToken();
    return typeof live === 'string' ? live : '';
  }
  const saved = await window.okbot.getSettings();
  return saved.gatewayHttpApi?.adminToken || '';
}
