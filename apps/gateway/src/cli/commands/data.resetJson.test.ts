import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from '../../storage/FileStorage.js';
import { dataCommand, resolveResetJsonPath } from './data.js';
import { messagesFor } from '../i18n.js';

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-reset-json-path-'));
  const storage = new FileStorage(dir);
  assert.equal(resolveResetJsonPath(storage, 'bots.json'), path.join(storage.dataRoot, 'bots.json'));
  assert.equal(resolveResetJsonPath(storage, 'squads.json'), path.join(storage.dataRoot, 'squads.json'));
  assert.equal(resolveResetJsonPath(storage, 'usage.json'), path.join(storage.dataRoot, 'usage.json'));
  assert.equal(
    resolveResetJsonPath(storage, 'api-token-usage.json'),
    path.join(storage.dataRoot, 'api-token-usage.json'),
  );
  assert.equal(resolveResetJsonPath(storage, 'server.json'), path.join(storage.root, 'server.json'));
  assert.equal(resolveResetJsonPath(storage, 'settings.json'), path.join(storage.root, 'settings.json'));
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // Corrupt data/bots.json is fixed in place; root bots.json is not created.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-reset-json-cli-'));
  const storage = new FileStorage(dir);
  const dataBots = path.join(storage.dataRoot, 'bots.json');
  fs.writeFileSync(dataBots, '{broken', 'utf8');
  const t = messagesFor('en');
  const code = await dataCommand(['reset-json', 'bots.json', '--data-dir', dir], t);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(dataBots, 'utf8')), []);
  assert.equal(fs.existsSync(path.join(dir, 'bots.json')), false, 'must not write root bots.json');
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // Valid server.json refused without --force.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-reset-json-refuse-'));
  const storage = new FileStorage(dir);
  const serverPath = path.join(storage.root, 'server.json');
  const good = JSON.stringify({ timezone: 'Asia/Shanghai' }, null, 2);
  fs.writeFileSync(serverPath, good, 'utf8');
  const t = messagesFor('en');
  const code = await dataCommand(['reset-json', 'server.json', '--data-dir', dir], t);
  assert.equal(code, 1);
  assert.equal(fs.readFileSync(serverPath, 'utf8'), good);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('data.resetJson.test.ts: ok');
