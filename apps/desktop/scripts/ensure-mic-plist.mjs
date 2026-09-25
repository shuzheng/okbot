#!/usr/bin/env node
/**
 * Electron.dev ships without NSMicrophoneUsageDescription.
 * Inject it into Electron.app Info.plist so askForMediaAccess can show the system dialog.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

function findElectronPlist() {
  try {
    const electronPath = require('electron');
    // electron package exports path to binary
    if (typeof electronPath === 'string' && electronPath.includes('Electron.app')) {
      const app = electronPath.slice(0, electronPath.indexOf('Electron.app') + 'Electron.app'.length);
      return path.join(app, 'Contents', 'Info.plist');
    }
  } catch {
    /* fall through */
  }
  const candidates = [
    path.resolve('node_modules/electron/dist/Electron.app/Contents/Info.plist'),
    path.resolve('../../node_modules/electron/dist/Electron.app/Contents/Info.plist'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const plist = findElectronPlist();
if (!plist) {
  console.warn('[okbot] Electron Info.plist not found; skip mic usage description');
  process.exit(0);
}

const keys = {
  NSMicrophoneUsageDescription: 'OkBot 需要使用麦克风，以便进行语音输入。',
  NSSpeechRecognitionUsageDescription: 'OkBot 需要语音识别权限，以便把说话内容转成文字。',
};

for (const [key, value] of Object.entries(keys)) {
  let existing = '';
  try {
    existing = execFileSync('/usr/bin/defaults', ['read', plist, key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    /* missing */
  }
  if (existing === value) continue;
  execFileSync('/usr/bin/defaults', ['write', plist, key, '-string', value]);
  console.log(`[okbot] wrote ${key} → ${plist}`);
}

// defaults write may convert to binary; keep readable
try {
  execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist]);
} catch {
  /* ignore */
}
