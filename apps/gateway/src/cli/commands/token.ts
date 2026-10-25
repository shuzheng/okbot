import { generateDistinctGatewayHttpApiToken } from '@okbot/shared';
import { FileStorage } from '../../storage';
import { isPidAlive, probeOkbotWithGatewayTokens, readServerLock } from '../../serverPresence';
import type { CliMessages } from '../i18n';

async function gatewayLooksRunning(storage: FileStorage): Promise<boolean> {
  const api = storage.getSettings().gatewayHttpApi;
  const lock = readServerLock(storage.root);
  const port = lock?.port && lock.port > 0 ? lock.port : api.port;
  if ((await probeOkbotWithGatewayTokens(port, 400, api.token, api.adminToken)).ok) return true;
  return !!(lock && isPidAlive(lock.pid));
}

type TokenRole = 'access' | 'admin';

function parseRole(raw: string | undefined): TokenRole | null {
  if (!raw) return null;
  if (raw === 'access' || raw === 'user') return 'access';
  if (raw === 'admin') return 'admin';
  return null;
}

export async function tokenCommand(args: string[], t: CliMessages): Promise<number> {
  const storage = new FileStorage();
  const sub = args[0];
  const roleArg = args[1];

  if (!sub || sub === 'show') {
    const role = parseRole(roleArg);
    if (roleArg && !role) {
      console.error(t.tokenUnknownRole(roleArg));
      return 1;
    }
    const api = storage.getSettings().gatewayHttpApi;
    console.log(t.tokenShowWarn);
    if (!role || role === 'access') {
      console.log(t.tokenAccessLabel);
      if (!api.token) console.log(t.tokenEmpty);
      else console.log(t.tokenValue(api.token));
    }
    if (!role || role === 'admin') {
      console.log(t.tokenAdminLabel);
      if (!api.adminToken) console.log(t.tokenAdminEmpty);
      else console.log(t.tokenValue(api.adminToken));
    }
    return 0;
  }

  if (sub === 'reset') {
    const role = parseRole(roleArg) || (roleArg ? null : 'access');
    if (!role) {
      console.error(t.tokenUnknownRole(roleArg || ''));
      return 1;
    }
    if (!roleArg) {
      console.log(t.tokenResetAccessDefault);
    }
    const settings = storage.getSettings();
    const api = settings.gatewayHttpApi;
    if (role === 'access') {
      const token = generateDistinctGatewayHttpApiToken(api.adminToken || '', 'access');
      storage.saveSettings({
        ...settings,
        gatewayHttpApi: { ...api, token },
      });
      console.log(t.tokenResetAccessDone);
      console.log(token);
    } else {
      const adminToken = generateDistinctGatewayHttpApiToken(api.token || '', 'admin');
      storage.saveSettings({
        ...settings,
        gatewayHttpApi: { ...api, adminToken },
      });
      console.log(t.tokenResetAdminDone);
      console.log(adminToken);
    }
    console.log(t.tokenResetClients);
    if (await gatewayLooksRunning(storage)) {
      console.log(t.tokenResetRestart);
    }
    return 0;
  }

  console.error(t.tokenUnknownSub(sub));
  return 1;
}
