import assert from 'node:assert/strict';
import { terminatePid } from './stopProcess';

{
  const signals: string[] = [];
  const result = await terminatePid(42, {
    waitMs: 50,
    pollMs: 10,
    sleep: async () => {},
    kill: (_pid, signal) => {
      signals.push(signal);
    },
    alive: () => false,
  });
  assert.equal(result, 'stopped');
  assert.deepEqual(signals, ['SIGTERM']);
}

{
  let aliveCalls = 0;
  const signals: string[] = [];
  const result = await terminatePid(7, {
    waitMs: 30,
    pollMs: 10,
    sleep: async () => {},
    kill: (_pid, signal) => {
      signals.push(signal);
    },
    alive: () => {
      aliveCalls += 1;
      // Stay alive through wait, die after SIGKILL
      return signals.length < 2;
    },
  });
  assert.equal(result, 'killed');
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(aliveCalls >= 1);
}

{
  const result = await terminatePid(99, {
    waitMs: 10,
    pollMs: 5,
    sleep: async () => {},
    kill: () => {
      const err = new Error('No such process') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    },
    alive: () => true,
  });
  assert.equal(result, 'gone');
}

console.log('cli/stopProcess.test.ts: ok');
