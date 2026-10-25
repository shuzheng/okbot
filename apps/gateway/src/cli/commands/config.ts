import { FileStorage } from '../../storage';
import { isPidAlive, probeOkbotHealth, readServerLock } from '../../serverPresence';
import type { CliMessages } from '../i18n';
import { maskToken, parseBool, parsePort } from '../parse';

async function gatewayLooksRunning(storage: FileStorage): Promise<boolean> {
  const api = storage.getSettings().gatewayHttpApi;
  const lock = readServerLock(storage.root);
  const port = lock?.port && lock.port > 0 ? lock.port : api.port;
  if (await probeOkbotHealth(port, 400, api.token)) return true;
  return !!(lock && isPidAlive(lock.pid));
}

function printShow(storage: FileStorage, t: CliMessages): void {
  const api = storage.getSettings().gatewayHttpApi;
  console.log(t.configShowTitle);
  console.log(t.configDataRoot(storage.root));
  console.log(t.configPort(api.port));
  console.log(t.configBindLan(api.bindLan));
  console.log(t.configServeUi(api.serveUi));
  console.log(t.configTokenMasked(maskToken(api.token)));
  console.log(t.configAdminTokenMasked(maskToken(api.adminToken || '')));
}

export type ConfigSetPatch = {
  port?: number;
  bindLan?: boolean;
  serveUi?: boolean;
};

/** Pure validation for `config set` flags (testable without storage). */
export function parseConfigSetArgs(args: string[]):
  | { ok: true; patch: ConfigSetPatch }
  | { ok: false; error: 'nothing' | 'invalid_port' | { kind: 'invalid_bool'; flag: string } } {
  const patch: ConfigSetPatch = {};
  let i = 0;
  while (i < args.length) {
    const flag = args[i]!;
    const rawVal = args[i + 1];
    if (flag === '--port') {
      const port = parsePort(rawVal);
      if (port == null) return { ok: false, error: 'invalid_port' };
      patch.port = port;
      i += 2;
      continue;
    }
    if (flag === '--bind-lan') {
      const v = parseBool(rawVal);
      if (v == null) return { ok: false, error: { kind: 'invalid_bool', flag: '--bind-lan' } };
      patch.bindLan = v;
      i += 2;
      continue;
    }
    if (flag === '--serve-ui') {
      const v = parseBool(rawVal);
      if (v == null) return { ok: false, error: { kind: 'invalid_bool', flag: '--serve-ui' } };
      patch.serveUi = v;
      i += 2;
      continue;
    }
    // Unknown flag — treat as nothing useful if empty patch later
    i += 1;
  }
  if (
    patch.port === undefined &&
    patch.bindLan === undefined &&
    patch.serveUi === undefined
  ) {
    return { ok: false, error: 'nothing' };
  }
  return { ok: true, patch };
}

export async function configCommand(args: string[], t: CliMessages): Promise<number> {
  const storage = new FileStorage();
  const sub = args[0];

  if (!sub || sub === 'show') {
    printShow(storage, t);
    return 0;
  }

  if (sub === 'set') {
    const parsed = parseConfigSetArgs(args.slice(1));
    if (!parsed.ok) {
      if (parsed.error === 'invalid_port') {
        console.error(t.configInvalidPort);
        return 1;
      }
      if (parsed.error === 'nothing') {
        console.error(t.configNothingToSet);
        return 1;
      }
      console.error(t.configInvalidBool(parsed.error.flag));
      return 1;
    }
    const settings = storage.getSettings();
    const next = {
      ...settings,
      gatewayHttpApi: {
        ...settings.gatewayHttpApi,
        ...(parsed.patch.port !== undefined ? { port: parsed.patch.port } : {}),
        ...(parsed.patch.bindLan !== undefined ? { bindLan: parsed.patch.bindLan } : {}),
        ...(parsed.patch.serveUi !== undefined ? { serveUi: parsed.patch.serveUi } : {}),
      },
    };
    storage.saveSettings(next);
    console.log(t.configUpdated);
    printShow(storage, t);
    if (await gatewayLooksRunning(storage)) {
      console.log(t.configRestartNote);
    }
    return 0;
  }

  console.error(t.configUnknownSub(sub));
  return 1;
}
