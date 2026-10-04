import assert from 'node:assert/strict';
import type { AppSettings } from '@okbot/shared';
import { parseMessagesLimit, resolveGatewaySettingsWrite } from './gatewaySettingsWrite';

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

console.log('gatewaySettingsWrite.test.ts: ok');
