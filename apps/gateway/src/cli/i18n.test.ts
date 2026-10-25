import assert from 'node:assert/strict';
import { detectLocale, messagesFor } from './i18n';

assert.equal(detectLocale({ OKBOT_LANG: 'zh' }), 'zh');
assert.equal(detectLocale({ OKBOT_LANG: 'en' }), 'en');
assert.equal(detectLocale({ OKBOT_LANG: 'ZH' }), 'zh');
assert.equal(detectLocale({ LANG: 'zh_CN.UTF-8' }), 'zh');
assert.equal(detectLocale({ LC_ALL: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' }), 'zh');
assert.equal(detectLocale({ LANG: 'en_US.UTF-8' }), 'en');
assert.equal(detectLocale({}), 'en');
assert.equal(detectLocale({ LANG: 'zh_CN.UTF-8' }, 'en'), 'en');
assert.equal(detectLocale({ LANG: 'en_US.UTF-8' }, 'zh'), 'zh');
assert.equal(detectLocale({ OKBOT_LANG: 'fr', LANG: 'zh_CN.UTF-8' }), 'zh');

const zh = messagesFor('zh');
const en = messagesFor('en');
assert.match(zh.usageTitle, /用法/);
assert.match(en.usageTitle, /Usage/);
assert.match(zh.cmdServe, /网关/);
assert.match(en.cmdServe, /gateway/i);
assert.match(zh.instanceBothRequired, /--port/);
assert.match(en.instanceBothRequired, /--port/);
assert.match(zh.serveHelp, /--data-dir/);
assert.match(en.serveHelp, /--data-dir/);

console.log('cli/i18n.test.ts: ok');
