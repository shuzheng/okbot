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
