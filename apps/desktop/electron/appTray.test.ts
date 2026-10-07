import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrayIconCandidates, pickTrayIconPath, trayResourcesDir } from './appTrayPaths';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-tray-'));
assert.equal(pickTrayIconPath(tmp, 'darwin'), null, 'empty dir → no icon path (ensureAppTray must fail)');

const darwin = listTrayIconCandidates(tmp, 'darwin');
assert.ok(darwin[0]?.endsWith('trayTemplate.png'));
assert.ok(darwin.some((p) => p.endsWith('trayTemplate@2x.png')));

const win = listTrayIconCandidates(tmp, 'win32');
assert.ok(win.every((p) => !p.includes('trayTemplate')));
assert.ok(win[0]?.endsWith('icon.png'));

fs.writeFileSync(path.join(tmp, 'icon.png'), 'x');
assert.equal(pickTrayIconPath(tmp, 'win32'), path.join(tmp, 'icon.png'));
fs.writeFileSync(path.join(tmp, 'trayTemplate.png'), 't');
assert.equal(pickTrayIconPath(tmp, 'darwin'), path.join(tmp, 'trayTemplate.png'));

assert.ok(trayResourcesDir('/app/out/main').replace(/\\/g, '/').endsWith('resources'));

const repoRes = path.join(path.dirname(fileURLToPath(import.meta.url)), '../resources');
if (fs.existsSync(path.join(repoRes, 'trayTemplate.png'))) {
  assert.equal(pickTrayIconPath(repoRes, 'darwin'), path.join(repoRes, 'trayTemplate.png'));
}

console.log('appTray.test.ts: ok');
