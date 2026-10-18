/**
 * Roster description prompt: duties/boundaries only; no tool/safety boilerplate.
 */
import assert from 'node:assert/strict';
import { buildOwnerDescriptionSystemPrompt } from './refresh.js';

const prompt = buildOwnerDescriptionSystemPrompt('助手');
assert.match(prompt, /职责与工作边界/);
assert.match(prompt, /也可查资料/);
assert.match(prompt, /读写本机文件/);
assert.match(prompt, /破坏性操作/);
assert.match(prompt, /密钥/);
assert.match(prompt, /SOUL\.md/);
assert.match(prompt, /200/);
assert.doesNotMatch(prompt, /必须输出 upsert/);

const seed = buildOwnerDescriptionSystemPrompt('助手', { forceUpsert: true });
assert.match(seed, /必须输出 upsert/);
assert.doesNotMatch(seed, /无更新/);

console.log('ownerDescription.prompt.test.ts: ok');
