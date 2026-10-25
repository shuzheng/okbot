import assert from 'node:assert/strict';
import { gatewayBootJs, gatewayLoginHtml, injectGatewayBoot, shouldServeGatewayLogin } from './gatewayLoginPage';

assert.equal(shouldServeGatewayLogin('GET', '/', false), true);
assert.equal(shouldServeGatewayLogin('GET', '/gateway-login', false), true);
assert.equal(shouldServeGatewayLogin('GET', '/gateway-login.html', true), true);
assert.equal(shouldServeGatewayLogin('GET', '/', true), false);
assert.equal(shouldServeGatewayLogin('GET', '/v1/bots', false), false);
assert.equal(shouldServeGatewayLogin('POST', '/', false), false);

const html = gatewayLoginHtml();
assert.match(html, /type="password"/);
assert.match(html, /网关服务/);
assert.doesNotMatch(html, /unauthorized/);
assert.match(html, /method="POST"/);
assert.match(html, /action="\/gateway-login"/);
assert.doesNotMatch(html, /sessionStorage/);
assert.doesNotMatch(html, /\?token=/);

const boot = gatewayBootJs();
assert.match(boot, /setTrafficLightPosition/);
assert.doesNotMatch(boot, /sessionStorage/);
assert.match(boot, /credentials:'include'/);
assert.match(boot, /\/v1\/app-info/);
assert.match(boot, /phase:'idle'/);
assert.match(boot, /settings_changed/);
assert.match(boot, /typeof event.type!=='string'/);
assert.doesNotMatch(
  boot,
  /event\.type==='sessions_changed'\|\|event\.type==='settings_changed'/,
  'durable /v1/events pump must forward turn events, not only roster/settings',
);
assert.match(boot, /\/v1\/events/);
assert.match(boot, /bindGatewayLiveSync/);
const injected = injectGatewayBoot(
  '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title></head><body></body></html>',
);
assert.match(
  injected,
  /<meta name="viewport"[^>]*><script src="\/gateway-boot.js"><\/script>/,
  'boot script must follow viewport meta so iOS Safari applies device-width first',
);
assert.doesNotMatch(
  injected,
  /<head><script src="\/gateway-boot.js"><\/script>/,
  'boot script must not lead <head> ahead of viewport',
);
assert.equal(injectGatewayBoot(injected), injected);

const noViewport = injectGatewayBoot('<html><head><meta charset="utf-8"></head><body></body></html>');
assert.match(noViewport, /<script src="\/gateway-boot.js"><\/script><\/head>/);

console.log('gatewayLoginPage.test.ts: ok');
