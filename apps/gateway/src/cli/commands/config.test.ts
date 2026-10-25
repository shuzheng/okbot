import assert from 'node:assert/strict';
import { parseConfigSetArgs } from './config';

{
  const r = parseConfigSetArgs(['--port', '19000']);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.patch.port, 19000);
}

{
  const r = parseConfigSetArgs(['--port', '80']);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'invalid_port');
}

{
  const r = parseConfigSetArgs(['--bind-lan', 'true', '--serve-ui', 'false']);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.patch.bindLan, true);
    assert.equal(r.patch.serveUi, false);
  }
}

{
  const r = parseConfigSetArgs(['--bind-lan', 'maybe']);
  assert.equal(r.ok, false);
  if (!r.ok && typeof r.error === 'object') assert.equal(r.error.flag, '--bind-lan');
}

{
  const r = parseConfigSetArgs([]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'nothing');
}

console.log('cli/commands/config.test.ts: ok');
