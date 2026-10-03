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

const boot = gatewayBootJs();
assert.match(boot, /setTrafficLightPosition/);
const injected = injectGatewayBoot('<html><head><meta charset="utf-8"></head><body></body></html>');
assert.match(injected, /<head><script src="\/gateway-boot.js"><\/script>/);
assert.equal(injectGatewayBoot(injected), injected);

console.log('gatewayLoginPage.test.ts: ok');

