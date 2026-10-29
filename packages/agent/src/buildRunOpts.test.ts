import assert from 'node:assert/strict';
import { buildRunOpts } from './hitl.js';

{
  const opts = buildRunOpts({});
  assert.equal(opts.stream, true);
  assert.equal(opts.toolNotFoundBehavior, 'return_error_to_model');
  assert.ok(typeof opts.maxTurns === 'number' && opts.maxTurns > 0);
}

{
  // Session path still carries the soft-fail option.
  const fakeSession = {} as import('@openai/agents').Session;
  const opts = buildRunOpts({ session: fakeSession });
  assert.equal(opts.toolNotFoundBehavior, 'return_error_to_model');
  assert.equal(opts.session, fakeSession);
  assert.equal(typeof opts.sessionInputCallback, 'function');
}

console.log('buildRunOpts.test.ts: ok');
