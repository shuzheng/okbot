import assert from 'node:assert/strict';
import {
  normalizeToolPreferences,
  DEFAULT_TOOL_PREFERENCES,
  TOOL_IDS,
} from './dist/index.js';

const empty = normalizeToolPreferences(undefined);
for (const id of TOOL_IDS) {
  assert.equal(empty[id].enabled, true, `${id} default enabled`);
  assert.equal(empty[id].approval, 'allow', `${id} default allow`);
}

const partial = normalizeToolPreferences({
  run_shell: { enabled: true },
  write_file: { enabled: false },
});
assert.equal(partial.run_shell.approval, 'allow');
assert.equal(partial.write_file.enabled, false);
assert.equal(partial.write_file.approval, 'allow');

const ask = normalizeToolPreferences({
  run_shell: { enabled: true, approval: 'ask' },
});
assert.equal(ask.run_shell.approval, 'ask');
assert.equal(ask.read_file.approval, DEFAULT_TOOL_PREFERENCES.read_file.approval);

console.log('toolIds.normalize.test.mjs: ok');
