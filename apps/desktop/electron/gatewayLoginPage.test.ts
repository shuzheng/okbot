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
const injected = injectGatewayBoot('<html><head><meta charset="utf-8"></head><body></body></html>');
assert.match(injected, /<head><script src="\/gateway-boot.js"><\/script>/);
assert.equal(injectGatewayBoot(injected), injected);

console.log('gatewayLoginPage.test.ts: ok');
