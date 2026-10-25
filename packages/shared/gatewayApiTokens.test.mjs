import assert from 'node:assert/strict';
import {
  normalizeGatewayHttpApiSettings,
  resolveGatewayAuth,
  resolveGatewayAuthRole,
  checkGatewayApiTokenQuota,
  createGatewayApiTokenEntry,
  generateGatewayHttpApiToken,
  totalTokensUsed,
} from './dist/index.js';

{
  // Legacy dual fields seed apiTokens
  const n = normalizeGatewayHttpApiSettings({
    port: 18765,
    token: 'user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    adminToken: 'admin_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
  assert.equal(n.apiTokens.length, 2);
  assert.equal(n.apiTokens[0].role, 'access');
  assert.equal(n.apiTokens[1].role, 'admin');
  assert.equal(n.token, n.apiTokens[0].token);
  assert.equal(n.adminToken, n.apiTokens[1].token);
}

{
  // List is source of truth; legacy mirrors first of each role
  const a = createGatewayApiTokenEntry({
    name: 'Alice',
    role: 'access',
    token: generateGatewayHttpApiToken('access'),
  });
  const b = createGatewayApiTokenEntry({
    name: 'Bob',
    role: 'access',
    token: generateGatewayHttpApiToken('access'),
  });
  const adm = createGatewayApiTokenEntry({
    name: 'Root',
    role: 'admin',
    token: generateGatewayHttpApiToken('admin'),
    limits: { dailyMessages: 10, totalMessages: 0, dailyTokens: 0, totalTokens: 1000 },
  });
  const n = normalizeGatewayHttpApiSettings({
    port: 19000,
    apiTokens: [a, b, adm],
    token: '',
    adminToken: '',
  });
  assert.equal(n.apiTokens.length, 3);
  assert.equal(n.token, a.token);
  assert.equal(n.adminToken, adm.token);
  assert.equal(n.port, 19000);

  const matchB = resolveGatewayAuth(b.token, n);
  assert.equal(matchB?.role, 'access');
  assert.equal(matchB?.tokenId, b.id);

  const matchAdm = resolveGatewayAuth(adm.token, n);
  assert.equal(matchAdm?.role, 'admin');
  assert.equal(matchAdm?.entry?.name, 'Root');

  assert.equal(resolveGatewayAuthRole('nope', n.token, n.adminToken, n.apiTokens), null);
  assert.equal(resolveGatewayAuthRole(b.token, n.token, n.adminToken, n.apiTokens), 'access');
}

{
  // Dual-arg role resolver still works without list
  assert.equal(resolveGatewayAuthRole('a', 'a', 'b'), 'access');
  assert.equal(resolveGatewayAuthRole('b', 'a', 'b'), 'admin');
  assert.equal(resolveGatewayAuthRole('a', 'a', 'a'), 'admin');
}

{
  assert.equal(totalTokensUsed({ input: 1, output: 2, cache: 3 }), 6);
  const unlimited = checkGatewayApiTokenQuota({
    limits: { dailyMessages: 0, totalMessages: 0, dailyTokens: 0, totalTokens: 0 },
    lifetimeMessages: 999,
    lifetimeTokens: 999,
    dailyMessages: 999,
    dailyTokens: 999,
    pendingMessages: 1,
  });
  assert.equal(unlimited.ok, true);

  const hitDailyMsg = checkGatewayApiTokenQuota({
    limits: { dailyMessages: 5, totalMessages: 0, dailyTokens: 0, totalTokens: 0 },
    lifetimeMessages: 1,
    lifetimeTokens: 0,
    dailyMessages: 5,
    dailyTokens: 0,
    pendingMessages: 1,
  });
  assert.equal(hitDailyMsg.ok, false);
  if (!hitDailyMsg.ok) assert.equal(hitDailyMsg.reason, 'daily_messages');

  const hitTotalTok = checkGatewayApiTokenQuota({
    limits: { dailyMessages: 0, totalMessages: 0, dailyTokens: 0, totalTokens: 100 },
    lifetimeMessages: 0,
    lifetimeTokens: 90,
    dailyMessages: 0,
    dailyTokens: 0,
    pendingTokens: 20,
  });
  assert.equal(hitTotalTok.ok, false);
  if (!hitTotalTok.ok) assert.equal(hitTotalTok.reason, 'total_tokens');
}

console.log('gatewayApiTokens.test.mjs: ok');
