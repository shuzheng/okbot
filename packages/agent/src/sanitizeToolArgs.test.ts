import assert from 'node:assert/strict';
import { sanitizeNullsInToolCallArguments } from '@okbot/shared';

{
  const item = {
    type: 'function_call',
    name: 'manage_schedule',
    callId: 'c1',
    arguments:
      '{"action":"create","prompt":"hi","title":"t","schedule":"daily 20:00","timezone":null,"job_id":null,"once":false}',
  };
  const out = sanitizeNullsInToolCallArguments(item);
  assert.notEqual(out, item);
  const args = JSON.parse(String(out.arguments));
  assert.equal(args.action, 'create');
  assert.equal(args.once, false);
  assert.ok(!('timezone' in args));
  assert.ok(!('job_id' in args));
}

{
  const item = {
    type: 'function_call',
    name: 'run_shell',
    arguments: '{"command":"ls","cwd":null}',
  };
  const out = sanitizeNullsInToolCallArguments(item);
  const args = JSON.parse(String(out.arguments));
  assert.deepEqual(args, { command: 'ls' });
}

{
  const item = { type: 'message', role: 'user', content: 'hi' };
  assert.equal(sanitizeNullsInToolCallArguments(item), item);
}


{
  const item = {
    type: 'function_call',
    name: 'manage_schedule',
    params: { action: 'create', timezone: null, once: true },
  };
  const out = sanitizeNullsInToolCallArguments(item);
  assert.notEqual(out, item);
  assert.deepEqual(out.params, { action: 'create', once: true });
  assert.equal(out.arguments, undefined);
  assert.deepEqual(item.params, { action: 'create', timezone: null, once: true });
}

{
  const item = {
    type: 'function_call',
    name: 'run_shell',
    arguments: { command: 'ls', cwd: '/tmp' },
  };
  const out = sanitizeNullsInToolCallArguments(item);
  assert.equal(out, item, 'same reference when no nulls');
}

console.log('sanitizeToolArgs.test.ts: ok');
