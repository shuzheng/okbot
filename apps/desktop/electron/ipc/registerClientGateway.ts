import { ipcMain } from 'electron';
import { IpcChannels } from '@okbot/shared';
import { probeOkbotHealth } from '@okbot/gateway';
import {
  LOCAL_GATEWAY_ID,
  loadPrefs,
  removeGateway,
  setActive,
  upsertGateway,
  type ClientGatewayEntry,
  type ClientGatewayPrefs,
} from '../clientGatewayPrefs';
import { loadClientSettings, saveClientSettings } from '../clientSettings';
import type { ClientSettings } from '@okbot/shared';
import { invokeApplyTheme } from '../windowChromeBridge';
import { invokeClientGatewaySwitch } from '../clientGatewaySwitch';
import { relaunchOkBotApp } from '../relaunchApp';

let registered = false;

function asEntry(raw: unknown): ClientGatewayEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const label = typeof o.label === 'string' ? o.label.trim() : '';
  const kind = o.kind === 'local' || o.kind === 'remote' ? o.kind : null;
  if (!id || !label || !kind) return null;
  const entry: ClientGatewayEntry = { id, label, kind };
  if (typeof o.baseUrl === 'string' && o.baseUrl.trim()) entry.baseUrl = o.baseUrl.trim();
  if (typeof o.token === 'string' && o.token.trim()) entry.token = o.token.trim();
  return entry;
}

/**
 * Client gateway prefs live in ~/.okbot/client.json (nested gateways).
 * Register always (owner + attach), like window controls — never route through
 * the gateway HTTP API.
 */
export function registerClientGatewayIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(IpcChannels.getClientGatewayPrefs, (): ClientGatewayPrefs => loadPrefs());

  ipcMain.handle(IpcChannels.setActiveClientGateway, (_e, id: unknown): ClientGatewayPrefs => {
    const next = typeof id === 'string' ? id : '';
    return setActive(next);
  });

  ipcMain.handle(IpcChannels.switchClientGateway, async (_e, id: unknown) => {
    const next = typeof id === 'string' ? id.trim() : '';
    if (!next) throw new Error('need_gateway_id');
    return invokeClientGatewaySwitch(next);
  });

  ipcMain.handle(IpcChannels.upsertClientGateway, (_e, raw: unknown): ClientGatewayPrefs => {
    const entry = asEntry(raw);
    if (!entry) return loadPrefs();
    return upsertGateway(entry);
  });

  ipcMain.handle(IpcChannels.removeClientGateway, (_e, id: unknown): ClientGatewayPrefs => {
    const next = typeof id === 'string' ? id : '';
    if (!next || next === LOCAL_GATEWAY_ID) return loadPrefs();
    return removeGateway(next);
  });


  ipcMain.handle(
    IpcChannels.probeClientGateway,
    async (
      _e,
      payload: unknown,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const o = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const baseUrl = typeof o.baseUrl === 'string' ? o.baseUrl.trim() : '';
      const token = typeof o.token === 'string' ? o.token.trim() : '';
      if (!baseUrl || !token) return { ok: false, error: 'need_fields' };
      try {
        const ok = await probeOkbotHealth(baseUrl, 3000, token);
        return ok ? { ok: true } : { ok: false, error: 'unreachable' };
      } catch {
        return { ok: false, error: 'unreachable' };
      }
    },
  );

  ipcMain.handle(IpcChannels.relaunchApp, () => {
    // Dev: re-enter pnpm/electron-vite (see relaunchApp.ts). Packaged: app.relaunch().
    relaunchOkBotApp();
    return true;
  });

  ipcMain.handle(IpcChannels.getClientSettings, (): ClientSettings => loadClientSettings());

  ipcMain.handle(IpcChannels.saveClientSettings, (_e, raw: unknown): ClientSettings => {
    const saved = saveClientSettings(raw as ClientSettings);
    // Attach path saves theme via HTTP bridge → this IPC. Must update nativeTheme /
    // vibrancy or macOS sidebar frost stays dark while chat CSS goes light.
    invokeApplyTheme(saved.theme);
    return saved;
  });
}
