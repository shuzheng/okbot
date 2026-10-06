import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAC_UPDATE_INSTALL_SCRIPT,
  isCachedUpdateZip,
  macBundleFromExe,
  macInstallTargetReady,
  recoverInterruptedMacUpdate,
  updateSha512ToHex,
  pickDownloadedSha512,
  readBundleIdentifier,
  MAC_INSTALL_SPACE_FACTOR,
} from './macUpdateInstall';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-mac-update-'));
const cache = path.join(root, 'Caches');
const updater = path.join(cache, 'okbot-updater', 'pending');
fs.mkdirSync(updater, { recursive: true });

const exe = path.join(root, 'OkBot.app', 'Contents', 'MacOS', 'OkBot');
fs.mkdirSync(path.dirname(exe), { recursive: true });
fs.writeFileSync(exe, 'old');
assert.equal(macBundleFromExe(exe), path.join(root, 'OkBot.app'));
assert.equal(macBundleFromExe(path.join(root, 'not-an-app')), null);

const zip = path.join(updater, 'OkBot-9.9.9-mac-arm64.zip');
fs.writeFileSync(zip, 'not-a-zip');
assert.equal(isCachedUpdateZip(zip, cache), true);
assert.equal(isCachedUpdateZip(path.join(cache, 'other.zip'), cache), false);
assert.equal(isCachedUpdateZip(path.join(root, 'OkBot-9.9.9-mac-arm64.zip'), cache), false);

assert.equal(updateSha512ToHex(crypto.createHash('sha512').update('x').digest('hex'))?.length, 128);
assert.equal(updateSha512ToHex(crypto.createHash('sha512').update('x').digest('base64'))?.length, 128);
assert.equal(updateSha512ToHex('nope'), null);

if (process.platform === 'darwin') {
  const src = path.join(root, 'New.app');
  const srcExe = path.join(src, 'Contents', 'MacOS', 'OkBot');
  fs.mkdirSync(path.dirname(srcExe), { recursive: true });
  fs.writeFileSync(srcExe, 'new-bytes');
  fs.chmodSync(srcExe, 0o755);
  const realZip = path.join(updater, 'real.zip');
  const zipped = spawnSync('ditto', ['-c', '-k', '--keepParent', src, realZip], { encoding: 'utf8' });
  assert.equal(zipped.status, 0, zipped.stderr);
  assert.equal(isCachedUpdateZip(realZip, cache), true);
  const sha = crypto.createHash('sha512').update(fs.readFileSync(realZip)).digest('hex');

  const script = path.join(root, 'install.sh');
  fs.writeFileSync(script, MAC_UPDATE_INSTALL_SCRIPT, { mode: 0o700 });
  const log = path.join(root, 'install.log');
  const app = path.join(root, 'OkBot.app');
  const ran = spawnSync(
    '/bin/bash',
    [script, '999999999', realZip, app, log, '0', sha],
    { encoding: 'utf8' },
  );
  assert.equal(ran.status, 0, `${ran.stderr}\n${fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''}`);
  const installed = fs.readFileSync(path.join(app, 'Contents', 'MacOS', 'OkBot'), 'utf8');
  assert.equal(installed, 'new-bytes');
  assert.equal(fs.existsSync(path.join(path.dirname(app), '.OkBot.app.previous')), false);
}

assert.equal(macInstallTargetReady(path.join(root, 'OkBot.app'), zip), true);
fs.chmodSync(root, 0o555);
assert.equal(macInstallTargetReady(path.join(root, 'OkBot.app'), zip), false);
fs.chmodSync(root, 0o755);

if (process.platform === 'darwin') {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const openLog = path.join(root, 'open.log');
  fs.writeFileSync(
    path.join(bin, 'open'),
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$OKBOT_OPEN_LOG"\nexit 0\n',
    { mode: 0o755 },
  );
  const bad = path.join(updater, 'bad.zip');
  fs.writeFileSync(bad, 'not-a-zip');
  const before = fs.readFileSync(path.join(root, 'OkBot.app', 'Contents', 'MacOS', 'OkBot'), 'utf8');
  // RELAUNCH=0 must not reopen on failure (will-quit path).
  const failed = spawnSync(
    '/bin/bash',
    [path.join(root, 'install.sh'), '999999999', bad, path.join(root, 'OkBot.app'), path.join(root, 'fail.log'), '0', 'abc'],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OKBOT_OPEN_LOG: openLog },
    },
  );
  assert.notEqual(failed.status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'OkBot.app', 'Contents', 'MacOS', 'OkBot'), 'utf8'), before);
  assert.equal(fs.existsSync(openLog), false);
  assert.equal(fs.existsSync(path.join(root, '.OkBot.app.previous')), false);

  // Wrong sha512 must fail even for a valid zip.
  const src2 = path.join(root, 'New2.app');
  const src2Exe = path.join(src2, 'Contents', 'MacOS', 'OkBot');
  fs.mkdirSync(path.dirname(src2Exe), { recursive: true });
  fs.writeFileSync(src2Exe, 'other');
  const zip2 = path.join(updater, 'real2.zip');
  assert.equal(spawnSync('ditto', ['-c', '-k', '--keepParent', src2, zip2]).status, 0);
  const statusFile = path.join(root, 'update-install-failed.json');
  const wrong = spawnSync(
    '/bin/bash',
    [path.join(root, 'install.sh'), '999999999', zip2, path.join(root, 'OkBot.app'), path.join(root, 'sha.log'), '1', '0'.repeat(128), statusFile],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OKBOT_OPEN_LOG: openLog },
    },
  );
  assert.notEqual(wrong.status, 0);
  assert.match(fs.readFileSync(path.join(root, 'sha.log'), 'utf8'), /sha512 mismatch/);
  assert.equal(JSON.parse(fs.readFileSync(statusFile, 'utf8')).reason, 'sha_mismatch');
  assert.equal(fs.readFileSync(openLog, 'utf8').trim(), path.join(root, 'OkBot.app'));
}

const okPlist = (id: string) =>
  `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`;
// Next-launch recovery: APP missing, .previous present.
const healRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-mac-heal-'));
const prev = path.join(healRoot, '.OkBot.app.previous');
const prevExe = path.join(prev, 'Contents', 'MacOS', 'OkBot');
fs.mkdirSync(path.dirname(prevExe), { recursive: true });
fs.writeFileSync(prevExe, 'restored');
fs.writeFileSync(path.join(prev, 'Contents', 'Info.plist'), okPlist('com.okbot.app'));
// A hidden bundle of another app is never restored.
const foreignPrev = path.join(healRoot, '.Foreign.app.previous');
fs.mkdirSync(path.join(foreignPrev, 'Contents'), { recursive: true });
fs.writeFileSync(path.join(foreignPrev, 'Contents', 'Info.plist'), okPlist('com.example.other'));
// Simulate launching from a different bundle while /Applications-style sibling is broken —
// recoverInterruptedMacUpdate also checks the exe bundle's parent.
const decoyExe = path.join(healRoot, 'Other.app', 'Contents', 'MacOS', 'Other');
fs.mkdirSync(path.dirname(decoyExe), { recursive: true });
fs.writeFileSync(decoyExe, 'decoy');
const healed = recoverInterruptedMacUpdate(decoyExe);
assert.equal(healed.recovered, true);
if (healed.recovered) {
  assert.equal(healed.restoredPath, path.join(healRoot, 'OkBot.app'));
  assert.equal(fs.existsSync(prev), false);
  assert.equal(
    fs.readFileSync(path.join(healRoot, 'OkBot.app', 'Contents', 'MacOS', 'OkBot'), 'utf8'),
    'restored',
  );
}
assert.equal(fs.existsSync(foreignPrev), true, 'foreign .previous must stay');
assert.equal(fs.existsSync(path.join(healRoot, 'Foreign.app')), false);
assert.equal(readBundleIdentifier(path.join(healRoot, 'OkBot.app')), 'com.okbot.app');
fs.rmSync(healRoot, { recursive: true, force: true });

// Query and hash in update URLs are not part of the file name.
assert.equal(
  pickDownloadedSha512(
    [
      { url: 'OkBot-1.0.0-mac-x64.zip?sig=1', sha512: crypto.createHash('sha512').update('qx').digest('base64') },
      { url: 'OkBot-1.0.0-mac-arm64.zip?sig=2#h', sha512: crypto.createHash('sha512').update('qa').digest('base64') },
    ],
    '/cache/OkBot-1.0.0-mac-arm64.zip',
    'x64',
  ),
  crypto.createHash('sha512').update('qa').digest('hex'),
);
assert.equal(MAC_INSTALL_SPACE_FACTOR, 5);

fs.rmSync(root, { recursive: true, force: true });
{
  // Manifest lists x64 first; an arm64 Mac downloads the arm64 zip.
  const h = (x: string) => crypto.createHash('sha512').update(x).digest('base64');
  const hex = (x: string) => crypto.createHash('sha512').update(x).digest('hex');
  const files = [
    { url: 'OkBot-1.0.0-mac.zip', sha512: h('x64') },
    { url: 'OkBot-1.0.0-arm64-mac.zip', sha512: h('arm') },
    { url: 'OkBot-1.0.0-mac-arm64.dmg', sha512: h('dmg') },
  ];
  assert.equal(pickDownloadedSha512(files, '/cache/okbot-updater/pending/OkBot-1.0.0-arm64-mac.zip', 'arm64'), hex('arm'));
  assert.equal(pickDownloadedSha512(files, '/cache/okbot-updater/pending/OkBot-1.0.0-mac.zip', 'arm64'), hex('x64'));
  // Unknown cache name: fall back to the zip of this arch.
  assert.equal(pickDownloadedSha512(files, '/cache/x/update.zip', 'arm64'), hex('arm'));
  assert.equal(pickDownloadedSha512(files, '/cache/x/update.zip', 'x64'), hex('x64'));
}
console.log('macUpdateInstall.test ok');
