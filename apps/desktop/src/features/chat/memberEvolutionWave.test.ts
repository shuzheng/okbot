import assert from 'node:assert/strict';
import {
  armEvolutionWaveIfVisible,
  evolutionWavePlayOptions,
  retainVisibleEvolutionWave,
} from './memberEvolutionWave';

{
  const prev: Record<string, number> = {};
  assert.deepEqual(armEvolutionWaveIfVisible(prev, 'bot-a', 'bot-a'), { 'bot-a': 1 });
  assert.equal(prev['bot-a'], undefined);
}

{
  const next = armEvolutionWaveIfVisible({ 'bot-a': 2 }, 'bot-a', 'bot-a');
  assert.deepEqual(next, { 'bot-a': 3 });
}

{
  const prev = { 'bot-a': 1 };
  assert.equal(armEvolutionWaveIfVisible(prev, 'bot-a', 'bot-b'), prev);
  assert.equal(armEvolutionWaveIfVisible(prev, 'bot-a', undefined), prev);
  assert.equal(armEvolutionWaveIfVisible(prev, '', 'bot-a'), prev);
}

{
  const prev = { 'bot-a': 4, 'squad-1': 1 };
  assert.deepEqual(retainVisibleEvolutionWave(prev, 'bot-a'), { 'bot-a': 4 });
  assert.deepEqual(retainVisibleEvolutionWave(prev, 'squad-1'), { 'squad-1': 1 });
  assert.deepEqual(retainVisibleEvolutionWave(prev, 'bot-z'), {});
  assert.deepEqual(retainVisibleEvolutionWave(prev, undefined), {});
}

{
  const only = { 'bot-a': 1 };
  assert.equal(retainVisibleEvolutionWave(only, 'bot-a'), only);
}

{
  const empty: Record<string, number> = {};
  assert.equal(retainVisibleEvolutionWave(empty, 'bot-a'), empty);
  assert.equal(retainVisibleEvolutionWave(empty, undefined), empty);
}

{
  const play = evolutionWavePlayOptions(200, 40);
  assert.deepEqual(play.source, { x: 100, y: 20, w: 0, h: 0 });
  assert.deepEqual(play.focus, { x: 100, y: 20 });
}

{
  const play = evolutionWavePlayOptions(0, 0);
  assert.deepEqual(play.source, { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(play.focus, { x: 0, y: 0 });
}

{
  const play = evolutionWavePlayOptions(99, 25);
  assert.equal(play.source.x, 49.5);
  assert.equal(play.source.y, 12.5);
  assert.equal(play.source.w, 0);
  assert.equal(play.source.h, 0);
  assert.deepEqual(play.focus, { x: 49.5, y: 12.5 });
}

console.log('memberEvolutionWave.test.ts: ok');
