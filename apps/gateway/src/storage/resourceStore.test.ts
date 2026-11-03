import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResourceStore } from './ResourceStore';
import { OwnerLifecycle } from './ownerLifecycle';

function isPathInside(parent: string, child: string): boolean {
  const root = path.resolve(parent);
  const target = path.resolve(child);
  if (target === root) return true;
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-resources-'));
}

function makeStore(root: string) {
  const ownerDir = (id: string) => path.join(root, id);
  const life = new OwnerLifecycle((id) => ownerDir(id));
  fs.mkdirSync(ownerDir('bot_test'), { recursive: true });
  const store = new ResourceStore(life, {
    ownerDir,
    ensureOwnerLayout: (id) => {
      fs.mkdirSync(ownerDir(id), { recursive: true });
    },
    ownerResourcesDir: (id) => {
      const d = path.join(ownerDir(id), 'resources');
      fs.mkdirSync(d, { recursive: true });
      return d;
    },
  });
  return store;
}

const root = tmpRoot();
try {
  const store = makeStore(root);

  // Empty library even if orphan file exists under resources/
  const orphan = path.join(root, 'bot_test', 'resources', 'orphan.png');
  fs.mkdirSync(path.dirname(orphan), { recursive: true });
  fs.writeFileSync(orphan, 'x');
  if (store.list('bot_test').length !== 0) throw new Error('should ignore orphan files');

  const note = store.addNote('bot_test', {
    title: 'Hello',
    html: '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>',
  });
  if (note.type !== 'note') throw new Error('note type');
  if (!note.path.endsWith('.html')) throw new Error('note should be .html');
  if (!fs.existsSync(note.path)) throw new Error('note file missing');

  const updated = store.upsertNote('bot_test', {
    id: note.id,
    html: '<!DOCTYPE html><html><body><h1>Hello2</h1></body></html>',
    title: 'Hello2',
  });
  if (updated.id !== note.id) throw new Error('upsert should keep id');
  if (!store.readText('bot_test', note.id).includes('Hello2')) throw new Error('upsert html');
  if (store.enrich('bot_test', updated).name.includes('.html')) {
    throw new Error('display name must hide .html');
  }

  const link = store.addLink('bot_test', {
    kind: 'url',
    target: 'https://example.com/a',
    title: 'Example',
  });
  if (link.type !== 'url' || link.path !== 'https://example.com/a') {
    throw new Error('url path convention');
  }

  const listed = store.list('bot_test');
  if (listed.length !== 2) throw new Error(`expected 2, got ${listed.length}`);

  const text = store.readText('bot_test', note.id);
  if (!text.includes('Hello')) throw new Error('readText');

  store.delete('bot_test', note.id);
  if (fs.existsSync(note.path)) throw new Error('ingested file should be unlinked');
  if (store.list('bot_test').length !== 1) throw new Error('after delete');

  store.delete('bot_test', link.id);
  if (store.list('bot_test').length !== 0) throw new Error('url delete metadata only');

  // Path traversal via unsanitized note id must not write outside resources/.
  const resourcesDir = path.join(root, 'bot_test', 'resources');
  const outsideProbe = path.join(root, 'bot_test', 'pwned-outside.html');
  const beforeOutside = fs.existsSync(outsideProbe);
  const trav = store.addNote('bot_test', {
    id: '../../../e',
    title: 'trav',
    html: '<!DOCTYPE html><html><body>pwn</body></html>',
  });
  if (trav.id.includes('..') || trav.id.includes('/') || trav.id.includes('\\')) {
    throw new Error('addNote must reject non-ULID caller id (got ' + trav.id + ')');
  }
  if (!isPathInside(resourcesDir, trav.path)) {
    throw new Error('note file escaped resourcesDir: ' + trav.path);
  }
  if (fs.existsSync(outsideProbe) && !beforeOutside) {
    throw new Error('traversal wrote outside resourcesDir');
  }
  // Relative path must stay under resources even if title has dots.
  const rel = path.relative(resourcesDir, path.resolve(trav.path));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('resolved note path not inside resourcesDir');
  }
  store.delete('bot_test', trav.id);

  // upsert miss with caller id must error (not create-with-caller-id).
  let upsertMissThrew = false;
  try {
    store.upsertNote('bot_test', {
      id: '../../../evil',
      html: '<!DOCTYPE html><html><body>x</body></html>',
    });
  } catch (err) {
    upsertMissThrew = /找不到笔记/.test(err instanceof Error ? err.message : String(err));
  }
  if (!upsertMissThrew) throw new Error('upsertNote miss with id should throw');
  if (fs.existsSync(outsideProbe) && !beforeOutside) {
    throw new Error('upsert miss traversal wrote outside');
  }

  const img = path.join(root, 'bot_test', 'resources', 'gen.png');
  fs.writeFileSync(img, 'png');
  const indexed = store.indexIngestedFile('bot_test', {
    filePath: img,
    title: 'gen',
    createdBy: 'assistant',
  });
  if (indexed.createdBy !== 'assistant') throw new Error('createdBy');
  if (store.list('bot_test').length !== 1) throw new Error('indexed');

  const md = path.join(root, 'bot_test', 'resources', '日报模板.md');
  fs.writeFileSync(md, '# 日报\n', 'utf8');
  const mdRec = store.indexIngestedFile('bot_test', {
    filePath: md,
    title: '日报模板.md',
    createdBy: 'assistant',
  });
  if (mdRec.type !== 'md') throw new Error('md type expected, got ' + mdRec.type);
  if (store.list('bot_test').length !== 2) throw new Error('expected image+md');

  console.log('resourceStore.test.ts OK');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
