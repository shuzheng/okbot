import assert from 'node:assert/strict';
import {
  composeDraftWithMentions,
  extractMentionEntities,
  filterMentionCatalog,
  filterSchedulesForOwner,
  formatMentionToken,
  groupMentionsByKind,
  humanizeMentionTokens,
  insertMentionInDraft,
  linkifyEntityMentions,
  mentionQueryAtCaret,
  mergeOwnerScopedSkills,
  parseMentionHref,
  parseMentionToken,
  removeMentionTokenFromDraft,
  splitEntityMentions,
  stripMentionTokens,
  type MentionEntityRef,
} from './entityMentions';

const catalog: MentionEntityRef[] = [
  { kind: 'bot', id: 'bot-tr', label: '翻译助手', emoji: '🔤', color: '#111' },
  { kind: 'squad', id: 'sq1', label: '研发小队', emoji: '👥' },
  {
    kind: 'schedule',
    id: 'job1',
    label: '早报',
    emoji: '⏰',
    subtitle: '翻译助手 · 每天 09:00',
  },
  {
    kind: 'skill',
    id: 'okbot-review',
    label: '代码评审',
    emoji: '🧩',
    subtitle: 'Review PRs',
  },
];

{
  const tok = formatMentionToken(catalog[2]!);
  assert.equal(tok, '@[schedule:job1|早报]');
  assert.deepEqual(parseMentionToken(tok), {
    kind: 'schedule',
    id: 'job1',
    label: '早报',
  });
}

{
  const segs = splitEntityMentions(
    '请 @[skill:okbot-review|代码评审] 看 @[schedule:job1|早报]',
    catalog,
  );
  assert.equal(segs.filter((s) => s.kind === 'mention').length, 2);
  const kinds = segs.filter((s) => s.kind === 'mention').map((s) => s.entity.kind);
  assert.deepEqual(kinds, ['skill', 'schedule']);
}

{
  const linked = linkifyEntityMentions('请 @翻译助手 帮忙', catalog);
  assert.match(linked, /\[@翻译助手\]\(okbot-mention:bot:bot-tr\)/);
}

{
  assert.deepEqual(parseMentionHref('okbot-mention:skill:okbot-review'), {
    kind: 'skill',
    id: 'okbot-review',
  });
  assert.deepEqual(parseMentionHref('okbot-mention:bot-tr'), {
    kind: 'bot',
    id: 'bot-tr',
  });
}

{
  const q = mentionQueryAtCaret('你好 @研', 5);
  assert.deepEqual(q, { start: 3, query: '研' });
  assert.equal(mentionQueryAtCaret('hello@x', 7), null);
  assert.equal(mentionQueryAtCaret('@[bot:1|A] more', 11), null);
}

{
  const hit = filterMentionCatalog(catalog, '早');
  assert.equal(hit.length, 1);
  assert.equal(hit[0]!.kind, 'schedule');
  const groups = groupMentionsByKind(catalog);
  assert.deepEqual(
    groups.map((g) => g.kind),
    ['bot', 'squad', 'schedule', 'skill'],
  );
}

{
  const jobs = [
    { id: 'j1', ownerId: 'bot-a', title: 'A1' },
    { id: 'j2', ownerId: 'bot-b', title: 'B1' },
    { id: 'j3', ownerId: 'bot-a', title: 'A2' },
  ];
  assert.deepEqual(
    filterSchedulesForOwner(jobs, 'bot-a').map((j) => j.id),
    ['j1', 'j3'],
  );
  assert.deepEqual(filterSchedulesForOwner(jobs, null), []);
  assert.deepEqual(filterSchedulesForOwner(jobs, ''), []);
}

{
  const merged = mergeOwnerScopedSkills([
    [{ slug: 'okbot-a', name: 'A' }],
    [{ slug: 'okbot-b', name: 'B' }, { slug: 'okbot-a', name: 'A2' }],
  ]);
  assert.deepEqual(
    merged.map((s) => s.slug),
    ['okbot-a', 'okbot-b'],
  );
  assert.equal(merged.find((s) => s.slug === 'okbot-a')!.name, 'A2');
}

{
  const catalog: MentionEntityRef[] = [
    { kind: 'schedule', id: 'job-1', label: '晨报' },
    { kind: 'skill', id: 'okbot-x', label: '蜂眼' },
  ];
  const draft = `@[schedule:job-1|晨报] @[skill:okbot-x|蜂眼] 你好`;
  assert.equal(stripMentionTokens(draft), '你好');
  assert.deepEqual(
    extractMentionEntities(draft, catalog).map((e) => `${e.kind}:${e.id}`),
    ['schedule:job-1', 'skill:okbot-x'],
  );
  const rebuilt = composeDraftWithMentions(
    extractMentionEntities(draft, catalog),
    '你好',
  );
  assert.equal(rebuilt, `@[schedule:job-1|晨报] @[skill:okbot-x|蜂眼] 你好`);
  assert.equal(stripMentionTokens(rebuilt), '你好');
}

{
  // Inline insert at caret (not prepended strip).
  const base = '请 @早 帮忙';
  const q = mentionQueryAtCaret(base, 4); // after @早
  assert.ok(q);
  const { draft, caret } = insertMentionInDraft(base, q!.start, q!.query, catalog[2]!);
  assert.equal(draft, '请 @[schedule:job1|早报] 帮忙');
  assert.equal(draft.slice(caret).trimStart(), '帮忙');
  assert.match(humanizeMentionTokens(draft), /@早报/);
}

{
  const draft = '前 @[bot:bot-tr|翻译助手] 中 @[skill:okbot-review|代码评审] 后';
  const next = removeMentionTokenFromDraft(draft, catalog[0]!);
  assert.equal(next, '前 中 @[skill:okbot-review|代码评审] 后');
  // Second remove keeps remaining text order.
  const next2 = removeMentionTokenFromDraft(next, catalog[3]!);
  assert.equal(next2.trim(), '前 中 后');
}

{
  // Insert mid-draft after existing token.
  const base = '@[bot:bot-tr|翻译助手] 看 @技';
  const q = mentionQueryAtCaret(base, base.length);
  assert.ok(q);
  const { draft } = insertMentionInDraft(base, q!.start, q!.query, catalog[3]!);
  assert.equal(
    draft.trim(),
    '@[bot:bot-tr|翻译助手] 看 @[skill:okbot-review|代码评审]',
  );
}

console.log('entityMentions.test.ts ok');
