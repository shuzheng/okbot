import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Squirrel.Mac (Electron's autoUpdater, used by electron-updater's MacUpdater)
 * only installs after the downloaded bundle satisfies the running app's code
 * requirement. This project ships unsigned / ad-hoc (electron-builder.yml has
 * no Developer ID). That check fails, so:
 * - MacUpdater.quitAndInstall() waits on native "update-downloaded" and never
 *   calls quitAndInstall, so the process stays up.
 * - ShipIt never receives a prepared update, so a normal quit does not install.
 * electron-updater has already sha512-checked the zip before "update-downloaded".
 * This helper swaps that zip onto the running .app after this process exits,
 * and re-verifies sha512 before the swap
 * (args: pid zip app log relaunch sha512hex statusJson).
 * On a late failure (sha mismatch, unzip, …) the helper writes `statusJson` so
 * the next launch can show why install failed — not only "failed to start".
 */
export const MAC_UPDATE_INSTALL_SCRIPT = `#!/bin/bash
set -u
trap '' HUP
PID="$1"
ZIP="$2"
APP="$3"
LOG="$4"
RELAUNCH="$5"
EXPECTED_SHA="\${6:-}"
STATUS="\${7:-}"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
log() { printf '%s %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
write_status() {
  if [ -z "$STATUS" ]; then
    return
  fi
  mkdir -p "$(dirname "$STATUS")" 2>/dev/null || true
  printf '{"reason":"%s","at":"%s"}\\n' "$1" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$STATUS" 2>/dev/null || true
}
moved_aside=0
committed=0
did_restore=0
reopen() {
  if [ "$RELAUNCH" != "1" ]; then
    return
  fi
  if [ -d "$APP" ]; then
    open "$APP" || log "could not reopen $APP"
  fi
}
restore() {
  if [ "$did_restore" = 1 ]; then
    return
  fi
  did_restore=1
  if [ "$moved_aside" = 1 ] && [ "$committed" != 1 ]; then
    log "interrupted after moving the app aside; restoring"
    rm -rf "$APP"
    if ! mv "$BACKUP" "$APP"; then
      log "restore failed"
    fi
    reopen
  fi
}
trap restore EXIT
trap 'write_status "interrupted"; restore; exit 1' INT TERM
fail() {
  log "$1"
  case "$1" in
    *sha512*) write_status "sha_mismatch" ;;
    *"ditto extract"*|*"zip has no"*) write_status "unzip_failed" ;;
    *) write_status "install_failed" ;;
  esac
  if [ "$moved_aside" != 1 ]; then
    reopen
  fi
  exit 1
}
for _ in $(seq 1 300); do
  if ! kill -0 "$PID" 2>/dev/null; then
    break
  fi
  sleep 0.2
done
if kill -0 "$PID" 2>/dev/null; then
  fail "pid $PID still running; not replacing the app"
fi
sleep 0.4
case "$APP" in
  *.app) ;;
  *) fail "refusing non-app path" ;;
esac
case "$ZIP" in
  *.zip) ;;
  *) fail "refusing non-zip" ;;
esac
if [ ! -f "$ZIP" ] || [ ! -d "$APP" ]; then
  fail "zip or app missing"
fi
if [ -n "$EXPECTED_SHA" ]; then
  ACTUAL=$(shasum -a 512 "$ZIP" 2>/dev/null | awk '{print $1}')
  if [ -z "$ACTUAL" ] || [ "$ACTUAL" != "$EXPECTED_SHA" ]; then
    fail "zip sha512 mismatch"
  fi
fi
TMP=$(mktemp -d /tmp/okbot-update.XXXXXX) || fail "could not make a temp dir"
cleanup() { rm -rf "$TMP"; }
if ! ditto -x -k "$ZIP" "$TMP"; then
  cleanup
  fail "ditto extract failed"
fi
NEW=$(find "$TMP" -maxdepth 2 -type d -name '*.app' -print -quit)
if [ -z "$NEW" ]; then
  cleanup
  fail "zip has no .app"
fi
PARENT=$(dirname "$APP")
NAME=$(basename "$APP")
STAGE="$PARENT/.$NAME.update"
BACKUP="$PARENT/.$NAME.previous"
rm -rf "$STAGE"
if ! ditto "$NEW" "$STAGE"; then
  rm -rf "$STAGE"
  cleanup
  fail "stage copy failed"
fi
cleanup
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  rm -rf "$BACKUP"
  if mv "$APP" "$BACKUP"; then
    moved_aside=1
    ok=1
    break
  fi
  sleep 0.3
done
if [ "$ok" != 1 ]; then
  rm -rf "$STAGE"
  fail "could not move the running app aside"
fi
if ! mv "$STAGE" "$APP"; then
  log "could not move the new app into place"
  write_status "swap_failed"
  rm -rf "$STAGE"
  exit 1
fi
if [ "$RELAUNCH" = "1" ]; then
  if ! open "$APP"; then
    log "could not open the new app"
    write_status "relaunch_failed"
    exit 1
  fi
fi
committed=1
rm -rf "$BACKUP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
log "installed $APP relaunch=$RELAUNCH"
`;

/**
 * Free space needed beside the app, as a multiple of the zip size. Extracting the
 * zip plus the staged copy peaked at about 4.4× the zip in measurements; 5× leaves
 * some headroom.
 */
export const MAC_INSTALL_SPACE_FACTOR = 5;

/** CFBundleIdentifier of OkBot (electron-builder `appId`). */
export const MAC_BUNDLE_ID = 'com.okbot.app';

/** CFBundleIdentifier from `<bundle>/Contents/Info.plist`, or null. XML or binary plist. */
export function readBundleIdentifier(bundle: string): string | null {
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  try {
    const raw = fs.readFileSync(plist);
    if (raw.subarray(0, 6).toString('latin1') !== 'bplist') {
      const m = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(raw.toString('utf8'));
      return m ? m[1]!.trim() : null;
    }
    if (process.platform !== 'darwin') return null;
    const out = spawnSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return out.status === 0 ? out.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

/** Parent of the running .app must be writable before we quit. Disk check is best-effort. */
export function macInstallTargetReady(bundle: string, zipPath: string): boolean {
  const parent = path.dirname(bundle);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    return false;
  }
  try {
    if (typeof fs.statfsSync !== 'function') return true;
    const st = fs.statfsSync(parent);
    const free = Number(st.bavail) * Number(st.bsize);
    const zipBytes = fs.statSync(zipPath).size;
    if (Number.isFinite(free) && Number.isFinite(zipBytes) && zipBytes > 0 && free < zipBytes * MAC_INSTALL_SPACE_FACTOR) {
      return false;
    }
  } catch {
    /* writability already passed */
  }
  return true;
}

export function macUpdaterCacheRoot(home = os.homedir()): string {
  return path.join(home, 'Library', 'Caches');
}

/** Running bundle from the executable path (.../Name.app/Contents/MacOS/Name). */
export function macBundleFromExe(exePath: string): string | null {
  const exe = path.resolve(exePath);
  const bundle = path.resolve(exe, '..', '..', '..');
  if (path.extname(bundle) !== '.app') return null;
  if (path.resolve(exe, '..') !== path.resolve(bundle, 'Contents', 'MacOS')) return null;
  return bundle;
}

/**
 * The zip electron-updater just verified. Reject anything that is not a real
 * file inside an electron-builder `*-updater` cache directory.
 */
export function isCachedUpdateZip(zipPath: string, cacheRoot: string): boolean {
  if (!zipPath || !path.isAbsolute(zipPath)) return false;
  if (path.extname(zipPath).toLowerCase() !== '.zip') return false;
  let realZip: string;
  let realRoot: string;
  try {
    if (!fs.statSync(zipPath).isFile()) return false;
    realZip = fs.realpathSync(zipPath);
    realRoot = fs.realpathSync(cacheRoot);
  } catch {
    return false;
  }
  const rel = path.relative(realRoot, realZip);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const top = rel.split(path.sep)[0] ?? '';
  return top.endsWith('-updater');
}

/** Normalize electron-builder sha512 (usually base64) to lowercase hex for the helper. */
export function updateSha512ToHex(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^[0-9a-f]{128}$/i.test(s)) return s.toLowerCase();
  try {
    const buf = Buffer.from(s, 'base64');
    if (buf.length !== 64) return null;
    return buf.toString('hex');
  } catch {
    return null;
  }
}

/**
 * sha512 of the zip electron-updater actually downloaded. The manifest lists
 * several files (x64 zip, arm64 zip, dmg); `files[0]` is often not the one
 * MacUpdater picked for this Mac, so match by file name, then by arch.
 */
export function pickDownloadedSha512(
  files: ReadonlyArray<{ url?: unknown; sha512?: unknown }> | undefined,
  downloadedFile: string | null | undefined,
  arch: string = process.arch,
): string | null {
  const list = (files ?? []).filter(
    (f): f is { url: string; sha512: string } => typeof f?.url === 'string' && typeof f?.sha512 === 'string',
  );
  const baseOf = (u: string) => {
    // Query and hash are not part of the file name.
    const noQuery = u.split(/[?#]/, 1)[0] ?? u;
    const last = noQuery.split('/').filter(Boolean).pop() ?? noQuery;
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  };
  const want = downloadedFile ? path.basename(downloadedFile) : '';
  const byName = want ? list.find((f) => baseOf(f.url) === want) : undefined;
  if (byName) return updateSha512ToHex(byName.sha512);
  const zips = list.filter((f) => /\.zip$/i.test(baseOf(f.url)));
  const isArm = (f: { url: string }) => baseOf(f.url).includes('arm64');
  const sameArch = zips.filter((f) => (arch === 'arm64' ? isArm(f) : !isArm(f)));
  if (sameArch.length === 1) return updateSha512ToHex(sameArch[0]!.sha512);
  if (zips.length === 1) return updateSha512ToHex(zips[0]!.sha512);
  return null;
}

export type MacUpdateRecovery =
  | { recovered: false }
  | { recovered: true; restoredPath: string; relaunch: boolean };

/**
 * Next-launch self-heal after a SIGKILL mid-swap left `.Name.app.previous` and
 * no `Name.app`. Also restores when the process was somehow started from the
 * hidden `.previous` bundle itself.
 */
export function recoverInterruptedMacUpdate(exePath: string, expectedId = MAC_BUNDLE_ID): MacUpdateRecovery {
  const tryRestore = (
    previous: string,
    target: string,
  ): Extract<MacUpdateRecovery, { recovered: true }> | null => {
    try {
      if (!fs.existsSync(previous)) return null;
      if (fs.existsSync(target)) return null;
      // Only put back a bundle that is OkBot (not any hidden *.app.previous).
      if (readBundleIdentifier(previous) !== expectedId) return null;
      fs.renameSync(previous, target);
      return { recovered: true, restoredPath: target, relaunch: true };
    } catch {
      return null;
    }
  };

  const bundle = macBundleFromExe(exePath);
  if (bundle) {
    const base = path.basename(bundle);
    const parent = path.dirname(bundle);
    if (base.startsWith('.') && base.endsWith('.app.previous')) {
      const targetName = base.slice(1, -'.previous'.length);
      const target = path.join(parent, targetName);
      const hit = tryRestore(bundle, target);
      if (hit) return hit;
    }
    const previous = path.join(parent, `.${base}.previous`);
    const hit = tryRestore(previous, bundle);
    if (hit) return { recovered: true, restoredPath: hit.restoredPath, relaunch: false };
    // Same folder may hold an orphaned .Name.app.previous after a mid-swap kill
    // while this process was started from another bundle (DMG / fresh copy).
    try {
      for (const ent of fs.readdirSync(parent)) {
        if (!ent.startsWith('.') || !ent.endsWith('.app.previous')) continue;
        const targetName = ent.slice(1, -'.previous'.length);
        const orphanPrev = path.join(parent, ent);
        const orphanTarget = path.join(parent, targetName);
        const orphanHit = tryRestore(orphanPrev, orphanTarget);
        if (orphanHit) return orphanHit;
      }
    } catch {
      /* ignore */
    }
  }

  const appsTarget = '/Applications/OkBot.app';
  const appsPrevious = '/Applications/.OkBot.app.previous';
  const appsHit = tryRestore(appsPrevious, appsTarget);
  if (appsHit) return appsHit;

  return { recovered: false };
}
