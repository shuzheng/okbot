import assert from 'node:assert/strict';
import { formatCappedMemoriesForPrompt } from './memoryPrompt';

{
  const globalEntries = Array.from({ length: 30 }, (_, i) => ({
    id: `g${i}`,
    memory: `global-${i}`,
  }));
  const localEntries = Array.from({ length: 30 }, (_, i) => ({
    id: `b${i}`,
    memory: `bot-${i}`,
  }));
  const text = formatCappedMemoriesForPrompt(globalEntries, localEntries, {
    maxEntries: 40,
    maxChars: 100_000,
  });
  const bullets = text.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(bullets.length, 40);
  assert.ok(text.includes('bot-29'));
  assert.ok(!text.includes('global-0'));
}

{
  const text = formatCappedMemoriesForPrompt(
    [{ id: 'g', memory: 'g'.repeat(50) }],
    [{ id: 'b', memory: 'b'.repeat(50) }],
    { maxEntries: 10, maxChars: 40 },
  );
  assert.ok(text.includes('本机器人记忆'));
  assert.ok(!text.includes('全局记忆'));
  assert.ok(text.length <= 80);
}

console.log('memoryPrompt.test.ts: ok');
