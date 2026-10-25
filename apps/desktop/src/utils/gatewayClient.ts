import {
  gatewayTokenPrefixRole,
  isLoopbackHostname,
  type GatewayAuthRole,
} from '@okbot/shared';
import type { SettingsTab } from '../features/settings/types';

/**
 * True when this window talks to the gateway over HTTP (attach window or Web UI).
 * The gateway blanks saved secrets, so callers may send a provider id instead of a key.
 *
 * Desktop Electron with the full preload never sets attach/boot markers or the
 * dataset flag, so WebUI updater skips must not treat the desktop shell as a
 * gateway client.
 */
export function isGatewayClient(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & {
    __okbotAttach?: unknown;
    __okbotGatewayBoot?: unknown;
  };
  // Explicit attach / gateway-boot markers (set before the renderer module runs).
  if (w.__okbotAttach || w.__okbotGatewayBoot) return true;
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.okbotGateway === '1';
}

/** Electron attach preload (`__okbotAttach`) — desktop chrome, HTTP to a gateway. */
export function isElectronAttach(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as Window & { __okbotAttach?: unknown }).__okbotAttach);
}

/**
 * Pure browser WebUI (gateway-hosted page) — no Electron shell / auto-updater.
 * Electron attach still has a local app updater even though isGatewayClient() is true.
 */
export function isPureWebUi(): boolean {
  return isGatewayClient() && !isElectronAttach();
}

/** Settings tabs that live under Settings → 网关端. */
export const GATEWAY_SIDE_SETTINGS_TABS: readonly SettingsTab[] = [
  'model',
  'tools',
  'security',
  'gateway',
  'extensions',
  'memory',
  'usage',
  'instructions',
] as const;

export function isGatewaySideSettingsTab(tab: SettingsTab): boolean {
  return (GATEWAY_SIDE_SETTINGS_TABS as readonly string[]).includes(tab);
}

type AttachBlob = {
  token?: unknown;
  base?: unknown;
  getAttachConfig?: () => { token?: unknown; base?: unknown } | null;
};

/** Token the Electron attach preload (or live getAttachConfig) is using. */
export function readAttachPresentedToken(): string {
  if (typeof window === 'undefined') return '';
  const raw = (window as Window & { __okbotAttach?: AttachBlob }).__okbotAttach;
  if (!raw) return '';
  try {
    const live = typeof raw.getAttachConfig === 'function' ? raw.getAttachConfig() : null;
    const tok = live?.token ?? raw.token;
    return typeof tok === 'string' ? tok.trim() : '';
  } catch {
    return typeof raw.token === 'string' ? raw.token.trim() : '';
  }
}

/**
 * Prefer server-reported role; fall back to `user_` / `admin_` prefix on the
 * presented token. Legacy unprefixed tokens yield null from prefix alone.
 */
export function resolveClientGatewayAuthRole(opts: {
  serverRole?: GatewayAuthRole | null;
  presentedToken?: string;
}): GatewayAuthRole | null {
  if (opts.serverRole === 'admin' || opts.serverRole === 'access') return opts.serverRole;
  return gatewayTokenPrefixRole(opts.presentedToken || '');
}

/** Attach base URL currently used by the Electron attach preload. */
export function readAttachBase(): string {
  if (typeof window === 'undefined') return '';
  const raw = (window as Window & { __okbotAttach?: AttachBlob }).__okbotAttach;
  if (!raw) return '';
  try {
    const live = typeof raw.getAttachConfig === 'function' ? raw.getAttachConfig() : null;
    const base = live?.base ?? (raw as { base?: unknown }).base;
    return typeof base === 'string' ? base.trim().replace(/\/+$/, '') : '';
  } catch {
    const base = (raw as { base?: unknown }).base;
    return typeof base === 'string' ? base.trim().replace(/\/+$/, '') : '';
  }
}

/** True when the attach base points at loopback (same machine as the gateway). */
export function isLoopbackAttachBase(base?: string): boolean {
  const raw = (base ?? readAttachBase()).trim();
  if (!raw) return false;
  try {
    const host = new URL(raw.includes('://') ? raw : `http://${raw}`).hostname;
    return isLoopbackHostname(host);
  } catch {
    return false;
  }
}

/**
 * Electron window attached to the local/default gateway on this host
 * (CLI `serve` or another owner may hold the lock). Not a remote client.
 */
export function isLocalHostElectronAttach(): boolean {
  return isElectronAttach() && isLoopbackAttachBase();
}

/**
 * Hide Settings → 网关端 only for **remote** clients with a user/access role.
 * Show when: owning Electron (not a gateway client), local-host Electron attach
 * (same machine / loopback), or admin/`admin_` token. While role is unknown on a
 * *remote* client, hide until admin is proven (avoids flashing gateway-side
 * controls to a user-token session).
 */
export function shouldHideGatewaySideSettings(opts: {
  gatewayClient: boolean;
  role: GatewayAuthRole | null | 'pending';
  /** Same-machine Electron attach (loopback / activeId local). */
  localHost?: boolean;
}): boolean {
  if (!opts.gatewayClient) return false;
  if (opts.localHost) return false;
  return opts.role !== 'admin';
}
