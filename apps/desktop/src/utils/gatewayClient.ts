/**
 * True when this window talks to the gateway over HTTP (attach window or Web UI).
 * The gateway blanks saved secrets, so callers may send a provider id instead of a key.
 */
export function isGatewayClient(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.okbotGateway === '1';
}
