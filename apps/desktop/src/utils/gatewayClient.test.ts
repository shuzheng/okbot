import assert from 'node:assert/strict';
import {
  isGatewaySideSettingsTab,
  resolveClientGatewayAuthRole,
  shouldHideGatewaySideSettings,
} from './gatewayClient';

assert.equal(isGatewaySideSettingsTab('gateway'), true);
assert.equal(isGatewaySideSettingsTab('general'), false);
assert.equal(isGatewaySideSettingsTab('gateways'), false);

assert.equal(resolveClientGatewayAuthRole({ serverRole: 'admin', presentedToken: 'user_x' }), 'admin');
assert.equal(resolveClientGatewayAuthRole({ serverRole: 'access', presentedToken: 'admin_x' }), 'access');
assert.equal(resolveClientGatewayAuthRole({ presentedToken: 'user_abc' }), 'access');
assert.equal(resolveClientGatewayAuthRole({ presentedToken: 'admin_abc' }), 'admin');
assert.equal(resolveClientGatewayAuthRole({ presentedToken: 'deadbeef' }), null);

assert.equal(shouldHideGatewaySideSettings({ gatewayClient: false, role: 'access' }), false);
assert.equal(shouldHideGatewaySideSettings({ gatewayClient: true, role: 'access' }), true);
assert.equal(shouldHideGatewaySideSettings({ gatewayClient: true, role: 'pending' }), true);
assert.equal(shouldHideGatewaySideSettings({ gatewayClient: true, role: null }), true);
assert.equal(shouldHideGatewaySideSettings({ gatewayClient: true, role: 'admin' }), false);
// Local-host Electron attach: keep 网关端 even with user/pending role.
assert.equal(
  shouldHideGatewaySideSettings({ gatewayClient: true, role: 'access', localHost: true }),
  false,
);
assert.equal(
  shouldHideGatewaySideSettings({ gatewayClient: true, role: 'pending', localHost: true }),
  false,
);
assert.equal(
  shouldHideGatewaySideSettings({ gatewayClient: true, role: 'access', localHost: false }),
  true,
);

console.log('gatewayClient.test.ts: ok');
