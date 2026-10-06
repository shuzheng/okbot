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
  localHttpApi: { enabled: true, port: 18765, token: 'saved-token', bindLan: false, serveUi: false },
  model: { providers: [{ id: 'p', apiKey: 'secret' }], defaultProviderId: 'p', defaultModelId: 'm' },
} as unknown as AppSettings;

{
  const decision = resolveGatewaySettingsWrite(current, {
    theme: 'dark',
    localHttpApi: { enabled: true, port: 18765, token: '', bindLan: false, serveUi: false },
    model: { providers: [{ id: 'p', apiKey: '' }], defaultProviderId: 'p', defaultModelId: 'm' },
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.next.theme, 'dark');
}

{
  const decision = resolveGatewaySettingsWrite(current, {
    theme: 'dark',
    localHttpApi: { enabled: true, port: 18765, token: 'new-token', bindLan: false, serveUi: false },
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.deepEqual(decision.rejectedKeys, ['localHttpApi']);
}

{
  // Auto-approval rules are allowed over the authenticated gateway.
  const rules = [{ id: 'aar_1', description: 'read_file', action: 'allow', createdAt: 'x', updatedAt: 'x' }];
  const decision = resolveGatewaySettingsWrite(current, { autoApprovalEnabled: true, autoApprovalRules: rules });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.next.autoApprovalEnabled, true);
    assert.deepEqual(decision.next.autoApprovalRules, rules);
  }
}

{
  // Tool policy, security, and computers stay desktop-only.
  const decision = resolveGatewaySettingsWrite(current, {
    autoApprovalEnabled: true,
    tools: { run_shell: { enabled: true, approval: 'allow' } },
    security: { enabled: false },
    computers: [{ id: 'c', name: 'x', host: 'h', port: 1, token: 't', enabled: true }],
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.deepEqual(decision.rejectedKeys.sort(), ['computers', 'security', 'tools']);
}

{
  // A broad keyword allow rule would silently allow every tool: desktop-only.
  const rules = [{ id: 'aar_x', description: 'a', action: 'allow', createdAt: 'x', updatedAt: 'x' }];
  const decision = resolveGatewaySettingsWrite(current, { autoApprovalEnabled: true, autoApprovalRules: rules });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.deepEqual(decision.rejectedKeys.sort(), ['autoApprovalEnabled', 'autoApprovalRules']);
}

{
  const desktopRules = [
    { id: 'k', description: 'git status', action: 'allow', createdAt: 'x', updatedAt: 'x' },
    { id: 'q', description: 'rm -rf', action: 'ask', createdAt: 'x', updatedAt: 'x' },
    { id: 'w', description: 'write_file', action: 'ask', createdAt: 'x', updatedAt: 'x' },
  ];
  const withRules = { ...current, autoApprovalEnabled: true, autoApprovalRules: desktopRules } as unknown as AppSettings;
  // Tool card: rewrite the exact-name ask rule to allow and add one tool rule.
  const card = resolveGatewaySettingsWrite(withRules, {
    autoApprovalEnabled: true,
    autoApprovalRules: [
      desktopRules[0],
      desktopRules[1],
      { ...desktopRules[2], action: 'allow', updatedAt: 'y' },
      { id: 'n', description: 'run_shell', action: 'allow', createdAt: 'y', updatedAt: 'y' },
    ],
  });
  assert.equal(card.ok, true);
  // Removing an ask rule loosens: rejected.
  assert.equal(
    resolveGatewaySettingsWrite(withRules, { autoApprovalRules: [desktopRules[0], desktopRules[2]] }).ok,
    false,
  );
  // Editing a desktop keyword rule: rejected.
  assert.equal(
    resolveGatewaySettingsWrite(withRules, {
      autoApprovalRules: [{ ...desktopRules[0], description: 'git' }, desktopRules[1], desktopRules[2]],
    }).ok,
    false,
  );
  // Asking more is fine: drop an allow rule, add an ask rule, turn off.
  assert.equal(
    resolveGatewaySettingsWrite(withRules, {
      autoApprovalEnabled: false,
      autoApprovalRules: [desktopRules[1], desktopRules[2], { id: 'z', description: 'curl', action: 'ask', createdAt: 'y', updatedAt: 'y' }],
    }).ok,
    true,
  );
  // Turning on with a desktop keyword allow rule present: rejected.
  const off = { ...withRules, autoApprovalEnabled: false } as AppSettings;
  assert.equal(resolveGatewaySettingsWrite(off, { autoApprovalEnabled: true }).ok, false);
}

console.log('gatewaySettingsWrite.test.ts: ok');

{
  // MCP is desktop-only. The blanked echo of env / header values is not an edit.
  const withMcp = {
    ...current,
    mcp: {
      enabled: true,
      servers: [{ id: 's', name: 's', enabled: true, transport: 'stdio', command: 'x', env: { TOKEN: 'secret' } }],
    },
  } as unknown as AppSettings;
  const echo = resolveGatewaySettingsWrite(withMcp, {
    notifications: false,
    mcp: {
      enabled: true,
      servers: [{ id: 's', name: 's', enabled: true, transport: 'stdio', command: 'x', env: { TOKEN: '' } }],
    },
  });
  assert.equal(echo.ok, true);
  if (echo.ok) {
    assert.equal(echo.next.notifications, false);
    assert.deepEqual(echo.next.mcp, withMcp.mcp);
  }
  const edit = resolveGatewaySettingsWrite(withMcp, {
    mcp: {
      enabled: true,
      servers: [{ id: 's', name: 's', enabled: true, transport: 'stdio', command: 'evil', env: { TOKEN: '' } }],
    },
  });
  assert.equal(edit.ok, false);
}

{
  // Gateway projection blanks secret args with the same function as backups;
  // the echo of the projected args is not an edit.
  const mcp = {
    enabled: true,
    servers: [
      {
        id: 's',
        name: 's',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'srv', '--header', 'Authorization: Bearer eyJabcdefghij.x.y', '--bearer=sk-live-1', '-p', 'hunter2', '--credentials-file', '/c.json'],
      },
    ],
  } as unknown as AppSettings['mcp'];
  const projected = blankMcpSecrets(mcp);
  assert.deepEqual(projected.servers[0]!.args, ['-y', 'srv', '--header', 'Authorization: ', '--bearer=', '-p', '', '--credentials-file', '/c.json']);
  const withArgs = { ...current, mcp } as unknown as AppSettings;
  const echo = resolveGatewaySettingsWrite(withArgs, { notifications: true, mcp: projected });
  assert.equal(echo.ok, true);
  if (echo.ok) assert.deepEqual(echo.next.mcp, mcp);
  const changed = JSON.parse(JSON.stringify(projected));
  changed.servers[0].args[1] = 'evil';
  assert.equal(resolveGatewaySettingsWrite(withArgs, { mcp: changed }).ok, false);
}
