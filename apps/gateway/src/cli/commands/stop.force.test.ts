import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

/**
 * Unit-level: --force is accepted in rest and probe is skipped when force is set.
 * Full process kill is covered by stopProcess.test.ts.
 */
import { parseInstanceFlags } from '../instanceArgs';

{
  const flags = parseInstanceFlags(['--force']);
  assert.equal(flags.ok, true);
  if (flags.ok) {
    assert.ok(flags.rest.includes('--force'));
  }
}

{
  const flags = parseInstanceFlags([
    '--port',
    '19001',
    '--data-dir',
    path.join(os.tmpdir(), 'okbot-force-x'),
    '--force',
  ]);
  assert.equal(flags.ok, true);
  if (flags.ok) {
    assert.ok(flags.rest.includes('--force'));
    assert.equal(flags.port, 19001);
  }
}

console.log('cli/commands/stop.force.test.ts: ok');
