import assert from 'node:assert/strict';
import { reconcileById } from './reconcileRoster';

const a1 = { id: 'a', name: 'A', emoji: '🦊' };
const a2 = { id: 'a', name: 'A', emoji: '🦊' }; // equal fields, new ref
const a3 = { id: 'a', name: 'A', emoji: '🐱' }; // avatar changed
const b1 = { id: 'b', name: 'B', emoji: '🐶' };

{
  const prev = [a1, b1];
  const out = reconcileById(prev, [a2, { ...b1 }]);
  assert.equal(out[0], a1, 'preserve identity when fields equal');
  assert.equal(out[1], b1, 'preserve other row identity');
}

{
  const prev = [a1, b1];
  assert.equal(reconcileById(prev, prev), prev, 'same array ref returned when next===prev');
  assert.equal(reconcileById(prev, [a1, b1]), prev, 'return prev when every row reused');
}

{
  const out = reconcileById([a1, b1], [a3, { ...b1 }]);
  assert.equal(out[0], a3, 'replace when avatar changes');
  assert.equal(out[1], b1, 'keep untouched bot identity');
  assert.notEqual(out[0], a1);
}

assert.deepEqual(reconcileById([a1], []), []);

console.log('reconcileRoster.test.ts: ok');
