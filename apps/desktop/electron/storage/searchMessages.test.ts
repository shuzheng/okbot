import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-search-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'Busy' });
const bot2 = storage.createBot({ name: 'Other' });
const squad = storage.createSquad({
  name: 'Team',
  members: [
    { botId: bot.id, role: 'a' },
    { botId: bot2.id, role: 'b' },
  ],
});

const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString();
// The bot has many older hits; the squad has one newer hit.
for (let i = 0; i < 10; i++) {
  storage.appendMessage(bot.id, { id: `b${i}`, role: 'user', content: `apple ${i}`, createdAt: at(i) });
}
storage.appendMessage(squad.id, { id: 's1', role: 'user', content: 'apple squad', createdAt: at(30) });

storage.appendMessage(squad.id, {
  id: 's2',
  role: 'assistant',
  content: 'apple from member',
  createdAt: at(31),
  speakerBotId: bot2.id,
});
// Runner plumbing in a squad (no speaker) is not a chat bubble.
storage.appendMessage(squad.id, { id: 's3', role: 'assistant', content: 'apple plumbing', createdAt: at(32) });

const hits = await storage.searchMessages('apple', { limit: 3 });
assert.equal(hits.length, 3);
assert.equal(hits[0]!.ownerKind, 'squad', 'newest hit (squad) must not starve behind bot hits');
assert.deepEqual(hits.map((h) => h.message.id), ['s2', 's1', 'b9']);
assert.equal(hits[0]!.speakerName, 'Other');

// Early stop: a huge, older chat is not read to the end once newer hits fill the limit.
const big = storage.createBot({ name: 'Big' });
const bigFile = path.join(root, big.id, 'session.jsonl');
const rows: string[] = [];
for (let i = 0; i < 20000; i++) {
  rows.push(JSON.stringify({ v: 2, id: `g${i}`, createdAt: at(-1000), item: { type: 'message', role: 'user', content: 'apple old' } }));
}
fs.writeFileSync(bigFile, rows.join('\n') + '\n');
const { ReverseLineReader } = await import('./messageSearch');
let reads = 0;
const origNext = ReverseLineReader.prototype.next;
ReverseLineReader.prototype.next = async function (this: InstanceType<typeof ReverseLineReader>) {
  reads += 1;
  return origNext.call(this);
};
const early = await storage.searchMessages('apple', { limit: 3 });
ReverseLineReader.prototype.next = origNext;
assert.deepEqual(early.map((h) => h.message.id), ['s2', 's1', 'b9']);
assert.ok(reads < 2000, `early stop expected, read ${reads} lines`);

// Lines that cross chunk borders parse correctly (reverse reader).
const all = await storage.searchMessages('apple old', { limit: 100 });
assert.equal(all.length, 100);
assert.ok(all.every((h) => h.botId === big.id));
const { ReverseLineReader: R } = await import('./messageSearch');
const small = path.join(root, 'lines.txt');
fs.writeFileSync(small, 'one\ntwo-long-line\n\nthree\n');
const r = new R(small, 3);
const got: string[] = [];
for (let l = await r.next(); l != null; l = await r.next()) got.push(l);
assert.deepEqual(got, ['three', 'two-long-line', 'one']);

// Rows out of time order (a reply written after a later row). Reviewer shape:
// B = [y1@5e5], A file order = [a1@1e6, a2@1], limit 2 → a1, y1.
{
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-search-order-'));
  const st2 = new FileStorage(r2);
  const A = st2.createBot({ name: 'A' });
  const B = st2.createBot({ name: 'B' });
  const iso = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();
  st2.appendMessage(B.id, { id: 'y1', role: 'user', content: 'kiwi y1', createdAt: iso(5e5) });
  st2.appendMessage(A.id, { id: 'a1', role: 'user', content: 'kiwi a1', createdAt: iso(1e6) });
  st2.appendMessage(A.id, { id: 'a2', role: 'user', content: 'kiwi a2', createdAt: iso(1) });
  assert.deepEqual((await st2.searchMessages('kiwi', { limit: 2 })).map((h) => h.message.id), ['a1', 'y1']);

  // Newest hit buried under older filler lines after a time regression.
  // Without the time index, reverse-read sees fillers first, frontier drops,
  // Small's mid hit fills limit=1, and Big's buried newest hit is skipped.
  const Big = st2.createBot({ name: 'Big' });
  const Small = st2.createBot({ name: 'Small' });
  const bigFile = path.join(r2, Big.id, 'session.jsonl');
  const bigRows: string[] = [];
  bigRows.push(
    JSON.stringify({
      v: 2,
      id: 'buried',
      createdAt: iso(8e6),
      item: { type: 'message', role: 'user', content: 'kiwi buried newest' },
    }),
  );
  for (let i = 0; i < 8000; i++) {
    bigRows.push(
      JSON.stringify({
        v: 2,
        id: `f${i}`,
        createdAt: iso(1e3 + i),
        item: { type: 'message', role: 'user', content: 'filler' },
      }),
    );
  }
  fs.writeFileSync(bigFile, bigRows.join('\n') + '\n');
  st2.appendMessage(Small.id, { id: 'mid', role: 'user', content: 'kiwi mid', createdAt: iso(5e6) });
  assert.deepEqual(
    (await st2.searchMessages('kiwi', { limit: 1 })).map((h) => h.message.id),
    ['buried'],
  );

  // Appending after the index was built: new rows are found (index extends).
  st2.appendMessage(B.id, { id: 'y2', role: 'user', content: 'kiwi y2', createdAt: iso(9.5e6) });
  assert.deepEqual((await st2.searchMessages('kiwi', { limit: 1 })).map((h) => h.message.id), ['y2']);
  // Rewrite in place (cleared then refilled): the stale index is not used.
  fs.writeFileSync(path.join(r2, B.id, 'session.jsonl'), '');
  st2.appendMessage(B.id, { id: 'y3', role: 'user', content: 'kiwi y3', createdAt: iso(9.9e6) });
  assert.deepEqual((await st2.searchMessages('kiwi', { limit: 1 })).map((h) => h.message.id), ['y3']);
  
  // Mid-search rewrite of a not-yet-selected file: must not keep a stale frontier.
  {
    const { ReverseLineReader } = await import('./messageSearch');
    const Hot = st2.createBot({ name: 'Hot' });
    const Cold = st2.createBot({ name: 'Cold' });
    const coldFile = path.join(r2, Cold.id, 'session.jsonl');
    const coldRows: string[] = [];
    for (let i = 0; i < 4000; i++) {
      coldRows.push(
        JSON.stringify({
          v: 2,
          id: `cold${i}`,
          createdAt: iso(1e6 + i),
          item: { type: 'message', role: 'user', content: i === 2000 ? 'racetag cold' : 'pad' },
        }),
      );
    }
    fs.writeFileSync(coldFile, coldRows.join('\n') + '\n');
    st2.appendMessage(Hot.id, { id: 'old', role: 'user', content: 'nope', createdAt: iso(50) });
    await st2.searchMessages('zzz-miss', { limit: 1 });
    let flipped = false;
    let calls = 0;
    const origNext = ReverseLineReader.prototype.next;
    ReverseLineReader.prototype.next = async function (this: InstanceType<typeof ReverseLineReader>) {
      const line = await origNext.call(this);
      calls++;
      // While Cold is reverse-read, rewrite Hot (still unopened) with a much newer hit.
      if (!flipped && calls === 30) {
        flipped = true;
        const hotPath = path.join(r2, Hot.id, 'session.jsonl');
        fs.writeFileSync(
          hotPath,
          JSON.stringify({
            v: 2,
            id: 'hotnew',
            createdAt: iso(9e7),
            item: { type: 'message', role: 'user', content: 'racetag hotnew' },
          }) + '\n',
        );
        const now = new Date();
        fs.utimesSync(hotPath, now, now);
      }
      return line;
    };
    try {
      assert.deepEqual(
        (await st2.searchMessages('racetag', { limit: 1 })).map((h) => h.message.id),
        ['hotnew'],
      );
      assert.equal(flipped, true, 'rewrite must run mid-search');
    } finally {
      ReverseLineReader.prototype.next = origNext;
    }
  }




  // Pure appends extend the cached index (checkpoint count only grows by the tail).
  {
    const { timeIndexFor } = await import('./messageSearch');
    const Grow = st2.createBot({ name: 'Grow' });
    const gFile = path.join(r2, Grow.id, 'session.jsonl');
    const row = (id: string, ms: number) =>
      JSON.stringify({
        v: 2,
        id,
        createdAt: iso(ms),
        item: { type: 'message', role: 'user', content: 'pad' },
      });
    // ~1.2MB so several checkpoints exist.
    const chunk: string[] = [];
    for (let i = 0; i < 12000; i++) chunk.push(row(`g${i}`, 1000 + i));
    fs.writeFileSync(gFile, chunk.join('\n') + '\n');
    const first = await timeIndexFor(gFile);
    assert.ok(first && first.checkpoints.length >= 2, 'baseline checkpoints');
    const cps0 = first!.checkpoints.length;
    const size0 = first!.size;
    for (let n = 0; n < 20; n++) {
      fs.appendFileSync(gFile, row(`a${n}`, 50_000 + n) + '\n');
      const next = await timeIndexFor(gFile);
      assert.ok(next, 'index after append');
      // Same object ⇒ extended in place (a full rebuild would allocate a new index).
      assert.equal(next, first, 'index object must be reused on pure append');
      assert.ok(next!.size > size0, 'indexed size grew');
      assert.ok(next!.checkpoints.length >= cps0, 'checkpoints only grow');
    }
  }

fs.rmSync(r2, { recursive: true, force: true });
}

fs.rmSync(root, { recursive: true, force: true });
console.log('searchMessages.test.ts: ok');
