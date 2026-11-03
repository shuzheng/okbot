/**
 * manage_note host binder: create/update/list/get + noteCard callback.
 */
import assert from 'node:assert/strict';
import type { NoteCardMeta, OwnerResourceRecord } from '@okbot/shared';
import { noteManageForOwner } from './noteTool';

function fakeStorage() {
  const notes = new Map<string, OwnerResourceRecord & { html: string }>();
  let seq = 0;
  const storage = {
    listOwnerResources() {
      return [...notes.values()].map(({ html: _h, ...r }) => ({
        ...r,
        name: r.title || 'note',
        size: 0,
        mtime: r.updatedAt,
      }));
    },
    getOwnerResource(_ownerId: string, id: string) {
      const row = notes.get(id);
      if (!row) return null;
      const { html: _h, ...rec } = row;
      return rec;
    },
    readOwnerResourceText(_ownerId: string, id: string) {
      const row = notes.get(id);
      if (!row) throw new Error('missing');
      return row.html;
    },
    upsertOwnerResourceNote(
      _ownerId: string,
      input: {
        id?: string;
        path?: string;
        title?: string;
        html: string;
        createdBy?: 'user' | 'assistant';
      },
    ) {
      if (input.id && notes.has(input.id)) {
        const prev = notes.get(input.id)!;
        const next = {
          ...prev,
          title: input.title ?? prev.title,
          html: input.html,
          updatedAt: new Date().toISOString(),
        };
        notes.set(input.id, next);
        const { html: _h, ...rec } = next;
        return rec;
      }
      seq += 1;
      const id = `res_note_${seq}`;
      const now = new Date().toISOString();
      const row = {
        id,
        type: 'note' as const,
        title: input.title || '未命名笔记',
        path: `/tmp/${id}.html`,
        createdAt: now,
        updatedAt: now,
        createdBy: input.createdBy || ('assistant' as const),
        html: input.html,
      };
      notes.set(id, row);
      const { html: _h, ...rec } = row;
      return rec;
    },
  };
  return { storage: storage as any, notes };
}

{
  const { storage } = fakeStorage();
  const cards: NoteCardMeta[] = [];
  const manage = noteManageForOwner(storage, 'bot_a', (c) => cards.push(c));

  const empty = await manage({ action: 'list' });
  assert.match(empty, /没有笔记/);

  const created = await manage({
    action: 'create',
    title: '设计稿',
    html: '<!DOCTYPE html><html><body><h1>设计</h1></body></html>',
  });
  assert.match(created, /已创建笔记/);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.title, '设计稿');
  assert.ok(cards[0]!.resourceId);

  const listed = await manage({ action: 'list' });
  assert.match(listed, /设计稿/);

  const got = await manage({ action: 'get', id: cards[0]!.resourceId });
  assert.match(got, /设计/);

  const updated = await manage({
    action: 'update',
    id: cards[0]!.resourceId,
    html: '<!DOCTYPE html><html><body><h1>设计v2</h1></body></html>',
  });
  assert.match(updated, /已更新笔记/);
  assert.equal(cards.length, 2);
  assert.equal(cards[1]!.resourceId, cards[0]!.resourceId);

  const bad = await manage({ action: 'update', html: '<p>x</p>' });
  assert.match(bad, /需要 id 或 path/);

  const dup = await manage({
    action: 'create',
    title: '设计稿',
    html: '<!DOCTYPE html><html><body><h1>dup</h1></body></html>',
  });
  assert.match(dup, /已有同题笔记/);
  assert.match(dup, /manage_note update/);
  assert.equal(cards.length, 2, 'duplicate create must not emit noteCard');

  console.log('noteTool.test.ts OK');
}
