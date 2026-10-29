import assert from 'node:assert/strict';
import type { AppSettings } from '@okbot/shared';
import { blankMcpSecrets, parseMessagesLimit, resolveGatewaySettingsWrite } from './gatewaySettingsWrite';

assert.equal(parseMessagesLimit(null), 50);
assert.equal(parseMessagesLimit(''), 50);
assert.equal(parseMessagesLimit('0'), 50);
assert.equal(parseMessagesLimit('nope'), 50);
assert.equal(parseMessagesLimit('10'), 10);
assert.equal(parseMessagesLimit('500'), 200);

const current = {
  theme: 'system',
  gatewayHttpApi: { enabled: true, port: 18765, token: 'saved-token', bindLan: false, serveUi: false },
  model: { providers: [{ id: 'p', apiKey: 'secret' }], defaultProviderId: 'p', defaultModelId: 'm' },
} as unknown as AppSettings;

{
  // Client chrome keys are ignored (not applied) — live in userData / localStorage.
  const decision = resolveGatewaySettingsWrite(current, {
    theme: 'dark',
    language: 'en',
    closeAction: 'tray',
    notifications: false,
    timezone: 'Asia/Shanghai',
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.next.theme, 'system');
  assert.equal(decision.next.closeAction, undefined);
  assert.equal(decision.next.timezone, 'Asia/Shanghai');
}

{
  // Admin may write host keys including gatewayHttpApi / tools / security / computers.
  const decision = resolveGatewaySettingsWrite(current, {
    gatewayHttpApi: { enabled: true, port: 18765, token: 'new-token', bindLan: false, serveUi: false },
    tools: { run_shell: { enabled: true, approval: 'allow' } },
    security: { enabled: false },
    computers: [{ id: 'c', name: 'x', host: 'h', port: 1, token: 't', enabled: true }],
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.next.gatewayHttpApi?.token, 'new-token');
  assert.equal((decision.next.tools as { run_shell?: { enabled?: boolean } })?.run_shell?.enabled, true);
  assert.equal((decision.next.security as { enabled?: boolean })?.enabled, false);
  assert.equal(decision.next.computers?.[0]?.id, 'c');
}

{
  // Attach/WebUI bootstrap blanks computer tokens; hydrate keeps rows; write must refill.
  const withComputer = {
    ...current,
    computers: [
      { id: 'c1', name: 'Sandbox', host: '127.0.0.1', port: 18790, token: 'live-secret', enabled: true },
    ],
    defaultComputerId: 'c1',
    security: {
      enabled: true,
      restrictToHome: true,
      allowedPathPrefixes: [],
      deniedPathPrefixes: [],
      shellPatternsEnabled: true,
      blockMode: 'reject' as const,
      agent: {
        maxInputCharsEnabled: true,
        maxInputChars: 50_000,
        rejectEmptyInput: false,
        jailbreakEnabled: true,
        injectionHygiene: false,
        piiPasteWarn: true,
        outputSecretsEnabled: false,
        toolOutputSecretsEnabled: false,
      },
    },
  } as unknown as AppSettings;
  const blankedPatch = {
    computers: [
      { id: 'c1', name: 'Sandbox', host: '127.0.0.1', port: 18790, token: '', enabled: true },
    ],
    defaultComputerId: 'c1',
    security: {
      enabled: true,
      restrictToHome: true,
      allowedPathPrefixes: [],
      deniedPathPrefixes: [],
      shellPatternsEnabled: true,
      blockMode: 'reject',
      agent: withComputer.security!.agent,
    },
  };
  const decision = resolveGatewaySettingsWrite(withComputer, blankedPatch);
  assert.equal(decision.ok, true);
  assert.equal(decision.next.computers?.[0]?.token, 'live-secret', 'carryOver must refill blanked computer token');
  assert.equal(decision.next.defaultComputerId, 'c1');
  assert.equal(decision.next.security?.agent?.jailbreakEnabled, true, 'security.agent must survive write');
  // Empty computers list must NOT resurrect prior entries (intentional clear).
  const cleared = resolveGatewaySettingsWrite(withComputer, { computers: [] });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.next.computers, []);
}

{
  // apiTokens: delete one OK; delete all via [] must not resurrect.
  const withTok = {
    ...current,
    gatewayHttpApi: {
      enabled: true,
      port: 18765,
      token: 'user_A',
      adminToken: 'admin_B',
      bindLan: false,
      serveUi: false,
      apiTokens: [
        { id: 'gat_a', name: 'User A', role: 'access', token: 'user_A', limits: { dailyMessages: 0, totalMessages: 0, dailyTokens: 0, totalTokens: 0 }, createdAt: 't', updatedAt: 't' },
        { id: 'gat_b', name: 'Admin', role: 'admin', token: 'admin_B', limits: { dailyMessages: 0, totalMessages: 0, dailyTokens: 0, totalTokens: 0 }, createdAt: 't', updatedAt: 't' },
        { id: 'gat_c', name: 'User C', role: 'access', token: 'user_C', limits: { dailyMessages: 0, totalMessages: 0, dailyTokens: 0, totalTokens: 0 }, createdAt: 't', updatedAt: 't' },
      ],
    },
  } as unknown as AppSettings;

  const delOne = resolveGatewaySettingsWrite(withTok, {
    gatewayHttpApi: {
      enabled: true,
      port: 18765,
      token: '',
      adminToken: '',
      bindLan: false,
      serveUi: false,
      apiTokens: [
        { id: 'gat_a', name: 'User A', role: 'access', token: '', limits: { dailyMessages: 0, totalMessages: 0, dailyTokens: 0, totalTokens: 0 }, createdAt: 't', updatedAt: 't' },
        { id: 'gat_b', name: 'Admin', role: 'admin', token: '', limits: { dailyMessages: 0, totalMessages: 0, dailyTokens: 0, totalTokens: 0 }, createdAt: 't', updatedAt: 't' },
      ],
    },
  });
  assert.equal(delOne.ok, true);
  const oneToks = delOne.next.gatewayHttpApi?.apiTokens || [];
  assert.equal(oneToks.length, 2, 'delete one leaves two');
  assert.equal(oneToks.find((e) => e.id === 'gat_a')?.token, 'user_A');
  assert.equal(oneToks.find((e) => e.id === 'gat_b')?.token, 'admin_B');
  assert.equal(oneToks.find((e) => e.id === 'gat_c'), undefined);

  const delAll = resolveGatewaySettingsWrite(withTok, {
    gatewayHttpApi: {
      enabled: true,
      port: 18765,
      token: '',
      adminToken: '',
      bindLan: false,
      serveUi: false,
      apiTokens: [],
    },
  });
  assert.equal(delAll.ok, true);
  assert.deepEqual(delAll.next.gatewayHttpApi?.apiTokens, [], 'delete all must not resurrect');
  assert.equal(delAll.next.gatewayHttpApi?.token, '', 'wipe clears legacy access');
  assert.equal(delAll.next.gatewayHttpApi?.adminToken, '', 'wipe clears legacy admin');

  // Attach empty-token placeholders still refill.
  const hydrate = resolveGatewaySettingsWrite(withTok, {
    gatewayHttpApi: {
      enabled: true,
      port: 18765,
      token: '',
      adminToken: '',
      bindLan: false,
      serveUi: false,
      apiTokens: withTok.gatewayHttpApi.apiTokens!.map((e) => ({ ...e, token: '' })),
    },
  });
  assert.equal(hydrate.ok, true);
  const hToks = hydrate.next.gatewayHttpApi?.apiTokens || [];
  assert.equal(hToks.length, 3);
  assert.equal(hToks.find((e) => e.id === 'gat_a')?.token, 'user_A');
  assert.equal(hToks.find((e) => e.id === 'gat_c')?.token, 'user_C');
}


{
  // Broad auto-approval rules are allowed for admin (same as owning desktop).
  const rules = [{ id: 'aar_x', description: 'a', action: 'allow', createdAt: 'x', updatedAt: 'x' }];
  const decision = resolveGatewaySettingsWrite(current, {
    autoApprovalEnabled: true,
    autoApprovalRules: rules,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.next.autoApprovalEnabled, true);
  assert.deepEqual(decision.next.autoApprovalRules, rules);
}

{
  // Sidebar pin/hide/groups + default assistant are gateway-writable.
  const decision = resolveGatewaySettingsWrite(current, {
    pinnedOwnerIds: ['bot_a'],
    hiddenOwnerIds: ['bot_b'],
    ownerGroups: [{ id: 'g1', name: 'Work' }],
    ownerGroupOrder: ['g1'],
    ownerGroupMembership: { bot_a: 'g1' },
    defaultAssistantId: 'bot_a',
  });
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.next.pinnedOwnerIds, ['bot_a']);
  assert.deepEqual(decision.next.hiddenOwnerIds, ['bot_b']);
  assert.equal(decision.next.defaultAssistantId, 'bot_a');
}

{
  // Admin may change MCP; blank env is carried over from live host config.
  const withMcp = {
    ...current,
    mcp: {
      enabled: false,
      servers: [{ id: 's', name: 's', enabled: true, transport: 'stdio', command: 'x', env: { TOKEN: 'secret' } }],
    },
  } as unknown as AppSettings;
  const adminEdit = resolveGatewaySettingsWrite(withMcp, {
    mcp: {
      enabled: true,
      servers: [{ id: 's', name: 's', enabled: true, transport: 'stdio', command: 'x', env: { TOKEN: '' } }],
    },
  });
  assert.equal(adminEdit.ok, true);
  assert.equal(adminEdit.next.mcp?.enabled, true);
  assert.equal((adminEdit.next.mcp?.servers?.[0] as { env?: { TOKEN?: string } })?.env?.TOKEN, 'secret');
}

{
  // Admin may write model apiKey; blank key on same provider/baseURL keeps the stored secret.
  const withModel = {
    ...current,
    model: {
      providers: [{ id: 'p1', name: 'P', baseURL: 'https://api.example', apiKey: 'sk-live', models: [] }],
    },
  } as unknown as AppSettings;
  const keep = resolveGatewaySettingsWrite(withModel, {
    model: {
      providers: [{ id: 'p1', name: 'P-renamed', baseURL: 'https://api.example', apiKey: '', models: [] }],
    },
  });
  assert.equal(keep.ok, true);
  const p = keep.next.model?.providers?.[0] as { name?: string; apiKey?: string };
  assert.equal(p?.name, 'P-renamed');
  assert.equal(p?.apiKey, 'sk-live');

  const setKey = resolveGatewaySettingsWrite(withModel, {
    model: {
      providers: [{ id: 'p1', name: 'P', baseURL: 'https://api.example', apiKey: 'sk-new', models: [] }],
    },
  });
  assert.equal(setKey.ok, true);
  assert.equal((setKey.next.model?.providers?.[0] as { apiKey?: string })?.apiKey, 'sk-new');
}

{
  // Gateway projection blanks secret args with the same function as backups.
  const mcp = {
    enabled: true,
    servers: [
      {
        id: 's',
        name: 's',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: [
          '-y',
          'srv',
          '--header',
          'Authorization: Bearer eyJabcdefghij.x.y',
          '--bearer=sk-live-1',
          '-p',
          'hunter2',
          '--credentials-file',
          '/c.json',
        ],
      },
    ],
  } as unknown as AppSettings['mcp'];
  const projected = blankMcpSecrets(mcp);
  assert.deepEqual(projected.servers[0]!.args, [
    '-y',
    'srv',
    '--header',
    'Authorization: ',
    '--bearer=',
    '-p',
    '',
    '--credentials-file',
    '/c.json',
  ]);
}

console.log('gatewaySettingsWrite.test.ts: ok');
