import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  expandHome,
  isDefaultOkbotRoot,
  parseInstanceFlags,
  resolveOkbotRoot,
} from './instanceArgs';
import { defaultOkbotRoot } from '../storage/okbotLayout';

assert.equal(expandHome('~'), os.homedir());
assert.equal(expandHome('~/okbot-alt'), path.join(os.homedir(), 'okbot-alt'));
assert.equal(expandHome('/tmp/x'), '/tmp/x');

assert.equal(resolveOkbotRoot(null), defaultOkbotRoot());
assert.equal(resolveOkbotRoot(undefined), defaultOkbotRoot());
assert.equal(resolveOkbotRoot('~/okbot-alt'), path.join(os.homedir(), 'okbot-alt'));
assert.ok(isDefaultOkbotRoot(defaultOkbotRoot()));
assert.equal(isDefaultOkbotRoot(path.join(os.homedir(), 'okbot-alt')), false);

{
  const p = parseInstanceFlags([]);
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.equal(p.port, null);
    assert.equal(p.dataDir, null);
    assert.deepEqual(p.rest, []);
  }
}

{
  const p = parseInstanceFlags(['--port', '19001', '--data-dir', '~/okbot-alt']);
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.equal(p.port, 19001);
    assert.equal(p.dataDir, '~/okbot-alt');
  }
}

{
  const p = parseInstanceFlags(['--data-dir=/tmp/okbot-x', '--port=19002']);
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.equal(p.port, 19002);
    assert.equal(p.dataDir, '/tmp/okbot-x');
  }
}

{
  const p = parseInstanceFlags(['--port', '19001']);
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.error, 'both_required');
}

{
  const p = parseInstanceFlags(['--data-dir', '~/okbot-alt']);
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.error, 'both_required');
}

{
  const p = parseInstanceFlags(['--port', '80', '--data-dir', '/tmp/x']);
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.error, 'invalid_port');
}

{
  const p = parseInstanceFlags(['--port', '19001', '--data-dir', '']);
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.error, 'invalid_data_dir');
}

{
  const p = parseInstanceFlags(['--port', '19001', '--data-dir', '~/alt', '--lang', 'en']);
  // --lang is global and normally stripped before command args; if present here it is rest.
  assert.equal(p.ok, true);
  if (p.ok) assert.deepEqual(p.rest, ['--lang', 'en']);
}

console.log('instanceArgs.test.ts: ok');
