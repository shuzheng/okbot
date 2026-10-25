import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './storage/FileStorage';
import { createGatewayHttpApi } from './gatewayHttpApi';
import { ensureGatewayToken } from './gatewayRuntime';
import type { IpcContext } from './ipc/context';
import { resolveGatewayAuthRole } from '@okbot/shared';

assert.equal(resolveGatewayAuthRole('a', 'a', 'b'), 'access');
assert.equal(resolveGatewayAuthRole('b', 'a', 'b'), 'admin');
assert.equal(resolveGatewayAuthRole('c', 'a', 'b'), null);
assert.equal(resolveGatewayAuthRole('a', 'a', 'a'), 'admin'); // identical strings → admin first

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-dual-token-'));
const storage = new FileStorage(root);

// Migration: keep access token, mint admin when missing
storage.saveSettings({
  ...storage.getSettings(),
  gatewayHttpApi: {
    ...storage.getSettings().gatewayHttpApi,
    token: 'access-token-keep',
    adminToken: '',
  },
});
const migrated = ensureGatewayToken(storage);
assert.equal(migrated.gatewayHttpApi.token, 'access-token-keep');
assert.ok(migrated.gatewayHttpApi.adminToken);
assert.notEqual(migrated.gatewayHttpApi.adminToken, 'access-token-keep');
assert.match(migrated.gatewayHttpApi.adminToken, /^admin_[0-9a-f]{48}$/);
assert.ok(migrated.gatewayHttpApi.apiTokens.length >= 2);
assert.ok(migrated.gatewayHttpApi.apiTokens.some((e) => e.role === 'access' && e.token === migrated.gatewayHttpApi.token));
assert.ok(migrated.gatewayHttpApi.apiTokens.some((e) => e.role === 'admin' && e.token === migrated.gatewayHttpApi.adminToken));

const ACCESS = migrated.gatewayHttpApi.token;
const ADMIN = migrated.gatewayHttpApi.adminToken;

const ctx = {
  storage,
  abortControllers: new Map(),
  pendingToolApprovals: new Map(),
  snapshotActiveRuns: () => ({ busyBotIds: [], pendingToolRequests: [] }),
  hardwareAccelerationActive: true,
} as unknown as IpcContext;
const api = createGatewayHttpApi({ ctx });

const port = await new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});

await api.listen({
  enabled: true,
  port,
  token: ACCESS,
  adminToken: ADMIN,
  bindLan: false,
  serveUi: false,
});
const base = `http://127.0.0.1:${port}`;

async function req(method: string, urlPath: string, token: string, body?: unknown) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// Access can read
{
  const r = await req('GET', '/v1/bots', ACCESS);
  assert.equal(r.status, 200, 'access can list bots');
}

// Access cannot POST settings
{
  const r = await req('POST', '/v1/settings', ACCESS, { timezone: 'Asia/Shanghai' });
  assert.equal(r.status, 403);
  assert.equal(r.json?.reason, 'admin_required');
}

// Access cannot mutating RPC
{
  const r = await req('POST', '/v1/rpc/createBot', ACCESS, { name: 'x' });
  assert.equal(r.status, 403);
  assert.equal(r.json?.reason, 'admin_required');
}

// Access can read RPC
{
  const r = await req('POST', '/v1/rpc/listScheduledJobs', ACCESS, {});
  assert.equal(r.status, 200);
  assert.equal(r.json?.ok, true);
}

// Admin can POST settings (may 409 for rejected keys, but not 403)
{
  const r = await req('POST', '/v1/settings', ADMIN, { timezone: 'Asia/Shanghai' });
  assert.notEqual(r.status, 403, `admin settings got ${r.status} ${JSON.stringify(r.json)}`);
  assert.ok(r.status === 200 || r.status === 409 || r.status === 400);
}

// Admin can call mutating RPC (may 400 for bad args, not 403)
{
  const r = await req('POST', '/v1/rpc/createBot', ADMIN, {});
  assert.notEqual(r.status, 403);
}

// gateway-token returns only presented role
{
  const accessTok = await req('GET', '/v1/gateway-token', ACCESS);
  assert.equal(accessTok.status, 200);
  assert.equal(accessTok.json?.role, 'access');
  assert.equal(accessTok.json?.token, ACCESS);

  const adminTok = await req('GET', '/v1/gateway-token', ADMIN);
  assert.equal(adminTok.status, 200);
  assert.equal(adminTok.json?.role, 'admin');
  assert.equal(adminTok.json?.token, ADMIN);
}

// Login accepts either
{
  const bad = await fetch(`${base}/gateway-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'wrong' }),
  });
  assert.equal(bad.status, 401);

  const okAccess = await fetch(`${base}/gateway-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ACCESS }),
    redirect: 'manual',
  });
  assert.equal(okAccess.status, 302);

  const okAdmin = await fetch(`${base}/gateway-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ADMIN }),
    redirect: 'manual',
  });
  assert.equal(okAdmin.status, 302);
}

// auth-challenge works for both
{
  const { verifyOkbotChallenge } = await import('./authChallenge');
  assert.equal(await verifyOkbotChallenge(port, ACCESS, 800), true);
  assert.equal(await verifyOkbotChallenge(port, ADMIN, 800), true);
  assert.equal(await verifyOkbotChallenge(port, 'nope', 800), false);
}


// Admin can write every gateway-host settings path
{
  const r = await req('POST', '/v1/settings', ADMIN, {
    mcp: { enabled: false, servers: [] },
    tools: {
      run_shell: { enabled: false, approval: 'ask' },
      read_file: { enabled: true, approval: 'allow' },
    },
    security: { enabled: true, restrictToHome: true },
    web: {
      search: { provider: 'tavily', apiKey: 'tvly-test', baseURL: '', compat: 'tavily' },
      fetch: { allowPrivateNetwork: false },
    },
    autoApprovalEnabled: true,
    autoApprovalRules: [
      { id: 'aar_broad', description: 'a', action: 'allow', createdAt: 'x', updatedAt: 'x' },
    ],
  });
  assert.equal(r.status, 200, `admin full host settings: ${JSON.stringify(r.json)}`);
  assert.equal(r.json?.ok, true);
  assert.equal(r.json?.settings?.mcp?.enabled, false);
  assert.equal(r.json?.settings?.tools?.run_shell?.enabled, false);
  assert.equal(r.json?.settings?.security?.enabled, true);
  assert.equal(r.json?.settings?.autoApprovalEnabled, true);
}

// Access cannot POST settings (403 admin_required)
{
  const r = await req('POST', '/v1/settings', ACCESS, {
    mcp: { enabled: true, servers: [] },
    tools: { run_shell: { enabled: true, approval: 'allow' } },
  });
  assert.equal(r.status, 403);
  assert.equal(r.json?.reason, 'admin_required');
}

// Access cannot MCP status
{
  const r = await req('GET', '/v1/mcp/status', ACCESS);
  assert.equal(r.status, 403);
  assert.equal(r.json?.reason, 'admin_required');
}

// Admin can MCP status
{
  const r = await req('GET', '/v1/mcp/status', ADMIN);
  assert.equal(r.status, 200, `admin mcp status: ${JSON.stringify(r.json)}`);
  assert.equal(r.json?.ok, true);
  assert.ok(Array.isArray(r.json?.servers));
}

// Access cannot backup export
{
  const r = await req('POST', '/v1/backup/export', ACCESS, { excludeSecrets: true });
  assert.equal(r.status, 403);
  assert.equal(r.json?.reason, 'admin_required');
}

// Admin backup export returns zip
{
  const res = await fetch(`${base}/v1/backup/export`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ADMIN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ excludeSecrets: true }),
  });
  assert.equal(res.status, 200, `admin backup export status ${res.status}`);
  assert.equal(res.headers.get('Content-Type'), 'application/zip');
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.ok(buf.length > 20, 'zip should not be empty');
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
}

// ensure does not re-mint when both present
{
  const again = ensureGatewayToken(storage);
  assert.equal(again.gatewayHttpApi.token, ACCESS);
  assert.equal(again.gatewayHttpApi.adminToken, ADMIN);
}

// Collision: identical access/admin must remint admin (keep access)
{
  storage.saveSettings({
    ...storage.getSettings(),
    gatewayHttpApi: {
      ...storage.getSettings().gatewayHttpApi,
      token: 'same-token-both',
      adminToken: 'same-token-both',
    },
  });
  const fixed = ensureGatewayToken(storage);
  assert.equal(fixed.gatewayHttpApi.token, 'same-token-both');
  assert.ok(fixed.gatewayHttpApi.adminToken);
  assert.notEqual(fixed.gatewayHttpApi.adminToken, 'same-token-both');
  assert.match(fixed.gatewayHttpApi.adminToken, /^admin_[0-9a-f]{48}$/);
}

// Fresh mint both roles get prefixes
{
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-dual-token-fresh-'));
  const storage2 = new FileStorage(root2);
  storage2.saveSettings({
    ...storage2.getSettings(),
    gatewayHttpApi: {
      ...storage2.getSettings().gatewayHttpApi,
      token: '',
      adminToken: '',
    },
  });
  const fresh = ensureGatewayToken(storage2);
  assert.match(fresh.gatewayHttpApi.token, /^user_[0-9a-f]{48}$/);
  assert.match(fresh.gatewayHttpApi.adminToken, /^admin_[0-9a-f]{48}$/);
  assert.notEqual(fresh.gatewayHttpApi.token, fresh.gatewayHttpApi.adminToken);
  // user_ prefix alone must not grant admin
  assert.equal(
    resolveGatewayAuthRole(fresh.gatewayHttpApi.token, fresh.gatewayHttpApi.token, fresh.gatewayHttpApi.adminToken),
    'access',
  );
  assert.equal(
    resolveGatewayAuthRole('user_' + '0'.repeat(48), fresh.gatewayHttpApi.token, fresh.gatewayHttpApi.adminToken),
    null,
  );
  fs.rmSync(root2, { recursive: true, force: true });
}


api.stop();
fs.rmSync(root, { recursive: true, force: true });
console.log('gatewayHttpApi.dualToken.test.ts: ok');
process.exit(0);
