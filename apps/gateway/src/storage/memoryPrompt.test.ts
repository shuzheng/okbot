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
  // Globals are preferred: all 30 globals should survive before locals fill the rest.
  assert.ok(text.includes('global-0'));
  assert.ok(text.includes('global-29'));
  assert.ok(text.includes('bot-29'));
  assert.ok(!text.includes('bot-0'));
}

{
  // Tiny char budget: keep a global rather than wiping globals for a local.
  const text = formatCappedMemoriesForPrompt(
    [{ id: 'g', memory: 'identity-fact' }],
    [{ id: 'b', memory: 'recent-local-note' }],
    { maxEntries: 10, maxChars: 60 },
  );
  assert.ok(text.includes('全局记忆') || text.includes('identity') || text.includes('折叠'));
  // Must not keep only the local while dropping the sole global silently.
  const onlyLocal =
    text.includes('本助手记忆') &&
    text.includes('recent-local') &&
    !text.includes('全局') &&
    !text.includes('identity') &&
    !text.includes('折叠');
  assert.equal(onlyLocal, false);
}

{
  const text = formatCappedMemoriesForPrompt(
    [{ id: 'g', memory: 'g-base' }],
    [
      { id: 'p', memory: 'pinned-local', pinned: true },
      { id: 'b', memory: 'old-local' },
    ],
    { maxEntries: 2, maxChars: 100_000 },
  );
  assert.ok(text.includes('pinned-local'));
  assert.ok(text.includes('g-base'));
}

console.log('memoryPrompt.test.ts: ok');
