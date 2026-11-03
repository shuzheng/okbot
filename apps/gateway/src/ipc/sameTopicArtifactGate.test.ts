/**
 * Same-topic artifact gate: note create + library write_file create.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findSameTopicResource,
  normalizeArtifactTopicKey,
  rejectDuplicateLibraryWrite,
  rejectDuplicateNoteCreate,
} from './sameTopicArtifactGate';
import type { OwnerResourceInfo } from '@okbot/shared';

{
  assert.equal(normalizeArtifactTopicKey('  贪吃蛇游戏.html '), '贪吃蛇游戏');
  assert.equal(normalizeArtifactTopicKey('Snake Game.HTML'), 'snake game');
  assert.equal(normalizeArtifactTopicKey('a.md'), 'a');
}

{
  const list: OwnerResourceInfo[] = [
    {
      id: 'res_1',
      type: 'html',
      title: '贪吃蛇游戏',
      path: '/tmp/owner/resources/贪吃蛇游戏.html',
      createdBy: 'assistant',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      name: '贪吃蛇游戏',
    },
    {
      id: 'res_note',
      type: 'note',
      title: '设计草稿',
      path: '/tmp/owner/resources/设计草稿.html',
      createdBy: 'assistant',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      name: '设计草稿',
    },
  ];
  const hit = findSameTopicResource(list, '贪吃蛇游戏.html');
  assert.ok(hit);
  assert.equal(hit!.id, 'res_1');
  const noteHit = findSameTopicResource(list, '设计草稿', { types: ['note'] });
  assert.ok(noteHit);
  assert.equal(noteHit!.id, 'res_note');
  assert.equal(findSameTopicResource(list, '设计草稿', { types: ['html'] }), null);
}

{
  const storage = {
    listOwnerResources() {
      return [
        {
          id: 'res_note',
          type: 'note' as const,
          title: '贪吃蛇游戏',
          path: '/tmp/owner/resources/贪吃蛇游戏.html',
          createdBy: 'assistant' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          name: '贪吃蛇游戏',
        },
      ];
    },
  };
  const err = rejectDuplicateNoteCreate(storage as never, 'bot_a', '贪吃蛇游戏');
  assert.ok(err);
  assert.match(err!, /manage_note update/);
  assert.match(err!, /res_note/);
  assert.equal(rejectDuplicateNoteCreate(storage as never, 'bot_a', '别的题目'), null);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-same-topic-'));
  const resourcesDir = path.join(root, 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  const existing = path.join(resourcesDir, '贪吃蛇游戏.html');
  fs.writeFileSync(existing, '<html></html>', 'utf8');

  const storage = {
    listOwnerResources() {
      return [
        {
          id: 'res_html',
          type: 'html' as const,
          title: '贪吃蛇游戏',
          path: existing,
          createdBy: 'assistant' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          name: '贪吃蛇游戏',
        },
      ];
    },
  };

  // Same path overwrite → allow
  assert.equal(
    rejectDuplicateLibraryWrite(
      storage as never,
      'bot_a',
      'resources/贪吃蛇游戏.html',
      resourcesDir,
    ),
    null,
  );

  // New path with same title/basename → reject
  const blocked = rejectDuplicateLibraryWrite(
    storage as never,
    'bot_a',
    'resources/games/贪吃蛇游戏.html',
    resourcesDir,
  );
  assert.ok(blocked);
  assert.match(blocked!, /edit_file/);
  assert.match(blocked!, /res_html/);

  // Unrelated new file under resources/ → allow
  assert.equal(
    rejectDuplicateLibraryWrite(
      storage as never,
      'bot_a',
      'resources/other.txt',
      resourcesDir,
    ),
    null,
  );

  // Work-root relative (not under resources/) → outside library scope → allow
  assert.equal(
    rejectDuplicateLibraryWrite(storage as never, 'bot_a', 'temp/scratch.sh', resourcesDir),
    null,
  );

  fs.rmSync(root, { recursive: true, force: true });
}

console.log('sameTopicArtifactGate.test.ts: ok');
