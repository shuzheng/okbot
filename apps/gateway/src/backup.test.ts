import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  carryOverSecrets,
  exportDataBackup,
  parseUnpackedBytes,
  restoreDataBackup,
  stripSettingsSecrets,
  takeRestoreNotice,
} from './backup';

const settings = {
  theme: 'dark',
  model: { providers: [{ id: 'p1', apiKey: 'k1' }] },
  gatewayHttpApi: { enabled: true, token: 't', adminToken: 'at' },
  computers: [{ id: 'c1', token: 'ct' }],
  mcp: { enabled: true, servers: [{ id: 's1', env: { A: 'secret' }, headers: { Authorization: 'x' } }] },
};
const stripped = stripSettingsSecrets(settings) as typeof settings;
assert.equal(stripped.model.providers[0]!.apiKey, '');
assert.equal(stripped.gatewayHttpApi.token, '');
assert.equal(stripped.gatewayHttpApi.adminToken, '');
assert.equal(stripped.computers[0]!.token, '');
assert.equal(stripped.mcp.servers[0]!.env.A, '');
assert.equal(stripped.theme, 'dark');
const carried = carryOverSecrets(stripped, settings) as typeof settings;
assert.deepEqual(carried, settings);

// apiTokens list: strip blanks secrets; carry restores by id
{
  const withList = {
    gatewayHttpApi: {
      enabled: true,
      token: 't1',
      adminToken: 'at1',
      apiTokens: [
        { id: 'gat_a', name: 'User', role: 'access', token: 'user_secret', limits: { dailyMessages: 0, totalMessages: 0, dailyTokens: 0, totalTokens: 0 }, createdAt: 1, updatedAt: 1 },
        { id: 'gat_b', name: 'Root', role: 'admin', token: 'admin_secret', limits: { dailyMessages: 10, totalMessages: 0, dailyTokens: 0, totalTokens: 0 }, createdAt: 1, updatedAt: 1 },
      ],
    },
  };
  const strippedList = stripSettingsSecrets(withList) as typeof withList;
  assert.equal(strippedList.gatewayHttpApi.token, '');
  assert.equal(strippedList.gatewayHttpApi.adminToken, '');
  assert.equal(strippedList.gatewayHttpApi.apiTokens[0]!.token, '');
  assert.equal(strippedList.gatewayHttpApi.apiTokens[1]!.token, '');
  const carriedList = carryOverSecrets(strippedList, withList) as typeof withList;
  assert.equal(carriedList.gatewayHttpApi.apiTokens[0]!.token, 'user_secret');
  assert.equal(carriedList.gatewayHttpApi.apiTokens[1]!.token, 'admin_secret');
  assert.equal(carriedList.gatewayHttpApi.token, 't1');
  assert.equal(carriedList.gatewayHttpApi.adminToken, 'at1');
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-bk-test-'));
const root = path.join(base, '.okbot');
fs.mkdirSync(path.join(root, 'data', 'bot_1'), { recursive: true });
fs.writeFileSync(path.join(root, 'server.json'), JSON.stringify(settings));
fs.writeFileSync(path.join(root, 'data', 'bot_1', 'session.jsonl'), 'hello\n');
fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({ pid: 1, port: 9, owner: 'serve' }));
fs.writeFileSync(path.join(root, 'client.json'), JSON.stringify({ theme: 'light' }));

const archive = exportDataBackup(root, path.join(base, 'b.zip'), { excludeSecrets: true });
assert.ok(fs.existsSync(archive));
assert.throws(() => exportDataBackup(root, path.join(root, 'inside.zip'), { excludeSecrets: false }));

// Change data, then restore: session comes back, secrets carried over from current settings.
fs.writeFileSync(path.join(root, 'data', 'bot_1', 'session.jsonl'), 'changed\n');
const { previousDir } = restoreDataBackup(root, archive);
assert.equal(fs.readFileSync(path.join(root, 'data', 'bot_1', 'session.jsonl'), 'utf8'), 'hello\n');
assert.equal(fs.readFileSync(path.join(previousDir, 'data', 'bot_1', 'session.jsonl'), 'utf8'), 'changed\n');
const restored = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8')) as typeof settings;
assert.equal(restored.model.providers[0]!.apiKey, 'k1');
assert.ok(!fs.existsSync(path.join(root, 'okbot-backup.json')));
// MCP is off after a restore; servers stay listed.
assert.equal(restored.mcp.enabled, false);
assert.equal(restored.mcp.servers.length, 1);
// Runtime lock + client.json stayed on this machine (skipped in archive, copied back).
assert.ok(fs.existsSync(path.join(root, 'runtime.json')));
assert.ok(fs.existsSync(path.join(root, 'client.json')));
// The user is told once after the relaunch.
assert.deepEqual(takeRestoreNotice(root), { mcpTurnedOff: true });
assert.equal(takeRestoreNotice(root), null);

// Legacy flat settings.json archive → restored as server.json
{
  const legacyBase = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-bk-legacy-'));
  const legacyRoot = path.join(legacyBase, '.okbot');
  fs.mkdirSync(path.join(legacyRoot, 'bot_1'), { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(legacyRoot, 'bot_1', 'session.jsonl'), 'legacy\n');
  const legacyArchive = exportDataBackup(legacyRoot, path.join(legacyBase, 'legacy.zip'), {
    excludeSecrets: true,
  });
  const target = path.join(legacyBase, 'target');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'server.json'), JSON.stringify(settings));
  restoreDataBackup(target, legacyArchive);
  assert.ok(fs.existsSync(path.join(target, 'server.json')));
  assert.ok(!fs.existsSync(path.join(target, 'settings.json')));
  const got = JSON.parse(fs.readFileSync(path.join(target, 'server.json'), 'utf8')) as typeof settings;
  assert.equal(got.model.providers[0]!.apiKey, 'k1');
  assert.equal(fs.readFileSync(path.join(target, 'bot_1', 'session.jsonl'), 'utf8'), 'legacy\n');
  fs.rmSync(legacyBase, { recursive: true, force: true });
}

// A backup whose endpoint changed must not receive the local secret.
{
  const local = {
    model: { providers: [{ id: 'p1', baseURL: 'https://api.good.example/v1', apiKey: 'k1' }] },
    computers: [{ id: 'c1', host: '10.0.0.2', port: 18790, token: 'ct' }],
    mcp: { enabled: true, servers: [{ id: 's1', transport: 'stdio', command: 'good', args: ['a'], env: { A: 'secret' } }] },
  };
  const evil = {
    model: { providers: [{ id: 'p1', baseURL: 'https://evil.example/v1', apiKey: '' }] },
    computers: [{ id: 'c1', host: 'evil.example', port: 18790, token: '' }],
    mcp: { enabled: true, servers: [{ id: 's1', transport: 'stdio', command: 'evil', args: ['a'], env: { A: '' } }] },
  };
  const out = carryOverSecrets(evil, local) as typeof local;
  assert.equal(out.model.providers[0]!.apiKey, '');
  assert.equal(out.computers[0]!.token, '');
  assert.equal(out.mcp.servers[0]!.env.A, '');
  // Same endpoint: carried over.
  const same = carryOverSecrets(stripSettingsSecrets(local), local) as typeof local;
  assert.equal(same.model.providers[0]!.apiKey, 'k1');
  assert.equal(same.computers[0]!.token, 'ct');
  assert.equal(same.mcp.servers[0]!.env.A, 'secret');
}

// Size totals: parse or fail closed.
assert.equal(parseUnpackedBytes('1 file, 3 bytes uncompressed, 3 bytes compressed:  0.0%'), 3);
assert.equal(parseUnpackedBytes('12 files, 1,234,567 bytes uncompressed, 9 bytes compressed: 1%'), 1234567);
assert.equal(parseUnpackedBytes('something else'), null);

// Token-looking args are blanked in secret-free backups and come back for the same server.
{
  const local = {
    mcp: {
      enabled: true,
      servers: [
        {
          id: 'a1',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'srv', '--token=abc', '--api-key', 'xyz', 'API_KEY=k', 'sk-live123', '--port', '9', '--header', 'Authorization: Bearer eyJabcdefghij.x.y', '--bearer=sk-live-1', '-p', 'hunter2', '--monkey=1', '--pass-through', '--credentials-file', '/c.json'],
          env: {},
        },
      ],
    },
  };
  const s = stripSettingsSecrets(local) as typeof local;
  assert.deepEqual(s.mcp.servers[0]!.args, ['-y', 'srv', '--token=', '--api-key', '', 'API_KEY=', '', '--port', '9', '--header', 'Authorization: ', '--bearer=', '-p', '', '--monkey=1', '--pass-through', '--credentials-file', '/c.json']);
  const back = carryOverSecrets(s, local) as typeof local;
  assert.deepEqual(back.mcp.servers[0]!.args, local.mcp.servers[0]!.args);
  // Different command: args stay blank.
  const moved = JSON.parse(JSON.stringify(s)) as typeof local;
  moved.mcp.servers[0]!.command = 'evil';
  assert.deepEqual((carryOverSecrets(moved, local) as typeof local).mcp.servers[0]!.args, s.mcp.servers[0]!.args);
}

// URL credentials are stripped from secret-free backups.
{
  const s = stripSettingsSecrets({
    mcp: { servers: [{ id: 'h', transport: 'http', url: 'https://u:p@mcp.example/x?api_key=abc&mode=1' }] },
  }) as { mcp: { servers: { url: string }[] } };
  assert.equal(s.mcp.servers[0]!.url, 'https://mcp.example/x?api_key=&mode=1');
}

// Not a backup → rejected, data untouched.
const bogus = path.join(base, 'bogus.zip');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-bk-bogus-'));
fs.writeFileSync(path.join(tmp, 'x.txt'), 'x');
execFileSync('zip', ['-q', bogus, 'x.txt'], { cwd: tmp });
assert.throws(() => restoreDataBackup(root, bogus));
assert.ok(fs.existsSync(path.join(root, 'server.json')));

fs.rmSync(base, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log('backup.test.ts: ok');
