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
  assert.equal(n.apiTokens[0].id, 'gat-legacy-access');
  assert.equal(n.apiTokens[1].id, 'gat-legacy-admin');
  // Re-normalize without persist keeps the same ids (quota buckets stable).
  const n2 = normalizeGatewayHttpApiSettings({
    port: 18765,
    token: n.token,
    adminToken: n.adminToken,
  });
  assert.equal(n2.apiTokens[0].id, 'gat-legacy-access');
  assert.equal(n2.apiTokens[1].id, 'gat-legacy-admin');
}

{
  // Duplicate ids: first wins (no remint).
  const tok = 'user_dup_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const a = createGatewayApiTokenEntry({ id: 'gat_same', name: 'A', role: 'access', token: tok });
  const b = createGatewayApiTokenEntry({
    id: 'gat_same',
    name: 'B',
    role: 'access',
    token: 'user_dup_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
  const n = normalizeGatewayHttpApiSettings({ port: 18765, apiTokens: [a, b] });
  assert.equal(n.apiTokens.length, 1);
  assert.equal(n.apiTokens[0].id, 'gat_same');
  assert.equal(n.apiTokens[0].token, tok);
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

{
  // Empty-token placeholders survive hydrate (attach/WebUI projection blanks secrets).
  const a = createGatewayApiTokenEntry({ id: 'gat_a', name: 'User A', role: 'access', token: 'user_A_secret_token_xx' });
  const b = createGatewayApiTokenEntry({ id: 'gat_b', name: 'Admin', role: 'admin', token: 'admin_B_secret_token_xx' });
  const c = createGatewayApiTokenEntry({ id: 'gat_c', name: 'User C', role: 'access', token: 'user_C_secret_token_xx' });
  const projected = [a, b, c].map((e) => ({ ...e, token: '' }));
  const hydrated = normalizeGatewayHttpApiSettings({
    port: 18765,
    token: '',
    adminToken: '',
    apiTokens: projected,
  });
  assert.equal(hydrated.apiTokens.length, 3, 'empty-token placeholders kept');
  assert.deepEqual(hydrated.apiTokens.map((e) => e.id).sort(), ['gat_a', 'gat_b', 'gat_c']);
  assert.ok(hydrated.apiTokens.every((e) => e.token === ''));

  // Add a new access token while placeholders remain (UI append).
  const neu = createGatewayApiTokenEntry({
    id: 'gat_new',
    name: 'User NEW',
    role: 'access',
    token: 'user_NEW_secret_tokenx',
  });
  const afterAdd = normalizeGatewayHttpApiSettings({
    port: 18765,
    token: '',
    adminToken: '',
    apiTokens: [...hydrated.apiTokens, neu],
  });
  assert.equal(afterAdd.apiTokens.length, 4);

  assert.ok(afterAdd.apiTokens.some((e) => e.id === 'gat_a' && e.token === ''));
  assert.ok(afterAdd.apiTokens.some((e) => e.id === 'gat_c' && e.token === ''));
  assert.ok(afterAdd.apiTokens.some((e) => e.id === 'gat_new' && e.token === 'user_NEW_secret_tokenx'));
  // First non-empty access mirrors to legacy (empty placeholders skipped).
  assert.equal(afterAdd.token, 'user_NEW_secret_tokenx');
}

{
  // Attach hydrate → save: all apiTokens blank must not wipe non-empty legacy.
  const liveTok = 'user_LIVE_secret_tokenx';
  const liveAdmin = 'admin_LIVE_secret_tokx';
  const live = normalizeGatewayHttpApiSettings({
    port: 18765,
    token: liveTok,
    adminToken: liveAdmin,
    apiTokens: [
      createGatewayApiTokenEntry({ id: 'gat_a', name: 'User A', role: 'access', token: liveTok }),
      createGatewayApiTokenEntry({ id: 'gat_b', name: 'Admin', role: 'admin', token: liveAdmin }),
    ],
  });
  assert.equal(live.token, liveTok);
  assert.equal(live.adminToken, liveAdmin);

  // Projection blanks secrets (GET /v1/settings attach).
  const projected = {
    port: live.port,
    token: '',
    adminToken: '',
    apiTokens: live.apiTokens.map((e) => ({ ...e, token: '' })),
  };
  // Naive normalize with blanked dual fields + blank list keeps legacy only when
  // dual fields still carry the prior values (saveLocal merges prev||patch).
  const preserved = normalizeGatewayHttpApiSettings({
    ...projected,
    token: live.token,
    adminToken: live.adminToken,
  });
  assert.equal(preserved.token, liveTok, 'legacy access kept when list all-empty');
  assert.equal(preserved.adminToken, liveAdmin, 'legacy admin kept when list all-empty');
  assert.ok(preserved.apiTokens.every((e) => e.token === '' || e.token === liveTok || e.token === liveAdmin));

  // Simulate saveLocalGatewayHttpApi: refill by id then normalize.
  const prevById = new Map(live.apiTokens.map((t) => [t.id, t]));
  const refilled = projected.apiTokens.map((t) => {
    const old = prevById.get(t.id);
    return { ...t, token: t.token || old?.token || '' };
  });
  const saved = normalizeGatewayHttpApiSettings({
    ...live,
    ...projected,
    apiTokens: refilled,
    token: projected.token || live.token,
    adminToken: projected.adminToken || live.adminToken,
  });
  assert.equal(saved.token, liveTok, 'attach hydrate→save preserves legacy access');
  assert.equal(saved.adminToken, liveAdmin, 'attach hydrate→save preserves legacy admin');
  assert.equal(saved.apiTokens.find((e) => e.id === 'gat_a')?.token, liveTok);
  assert.equal(saved.apiTokens.find((e) => e.id === 'gat_b')?.token, liveAdmin);
}


{
  // Missing id on disk: normalize must be stable across calls (quota buckets).
  const tok = 'user_noid_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const a = normalizeGatewayHttpApiSettings({
    port: 18765,
    apiTokens: [{ name: 'NoId', role: 'access', token: tok }],
  });
  const b = normalizeGatewayHttpApiSettings({
    port: 18765,
    apiTokens: [{ name: 'NoId', role: 'access', token: tok }],
  });
  assert.equal(a.apiTokens.length, 1);
  assert.equal(a.apiTokens[0].id, b.apiTokens[0].id);
  assert.ok(a.apiTokens[0].id.startsWith('gat-seed-'));
  assert.notEqual(a.apiTokens[0].id, createGatewayApiTokenEntry({ name: 'X', role: 'access', token: tok + 'z' }).id);
}
