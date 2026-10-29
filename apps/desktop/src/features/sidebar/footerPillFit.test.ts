import assert from 'node:assert/strict';
import {
  capFooterPillExtras,
  fitFooterPills,
  resolveFooterPillExpanded,
} from './footerPillFit';

const C = 36;
const G = 8;

/** Full expand (3 slots) + 2 circles + 2 gaps */
const FULL_2 = C * 3 + C + C + G * 2; // 196
/** All three as circles */
const CIRCLES_3 = C * 3 + G * 2; // 124

assert.deepEqual(
  fitFooterPills(FULL_2, { hasUpdate: true, circle: C, gap: G }),
  { visible: ['settings', 'market', 'update'], extras: 2 },
  'keeps full expand (extras=2) when width is enough',
);

assert.deepEqual(
  fitFooterPills(CIRCLES_3 + 1, { hasUpdate: true, circle: C, gap: G }),
  { visible: ['settings', 'market', 'update'], extras: 0 },
  'hides extras before dropping buttons',
);

assert.deepEqual(
  fitFooterPills(C * 2 + G, { hasUpdate: true, circle: C, gap: G }),
  { visible: ['settings', 'market'], extras: 0 },
  'drops update (rightmost) before market/settings',
);

const oneExtra2 = C * 2 + C + G; // 116 — fits 2+1 extra, not 3 circles
assert.deepEqual(
  fitFooterPills(oneExtra2, { hasUpdate: true, circle: C, gap: G }),
  { visible: ['settings', 'market'], extras: 1 },
  'restores extras on remaining before restoring dropped pills',
);

assert.deepEqual(
  fitFooterPills(C, { hasUpdate: true, circle: C, gap: G }),
  { visible: ['settings'], extras: 0 },
  'drops market before settings when very tight',
);

assert.deepEqual(
  fitFooterPills(C * 3 + C + G, { hasUpdate: false, circle: C, gap: G }),
  { visible: ['settings', 'market'], extras: 2 },
  'omits update candidate when hasUpdate is false; extras up to 2',
);

const with1 = C * 2 + C * 2 + G * 2; // 160
assert.deepEqual(
  fitFooterPills(with1, { hasUpdate: true, circle: C, gap: G }),
  { visible: ['settings', 'market', 'update'], extras: 1 },
  'progressive extras: keeps all buttons at extras=1',
);
assert.deepEqual(
  fitFooterPills(with1 - 1, { hasUpdate: true, circle: C, gap: G }),
  { visible: ['settings', 'market', 'update'], extras: 0 },
  'progressive extras: then extras=0 before dropping pills',
);

const with2 = C * 3 + C * 2 + G * 2; // 196 — 3-slot expand + 2 circles
assert.deepEqual(
  fitFooterPills(with2, { hasUpdate: true, circle: C, gap: G }),
  { visible: ['settings', 'market', 'update'], extras: 2 },
  'progressive extras: extras=2 is the max',
);
assert.deepEqual(
  fitFooterPills(with2 - 1, { hasUpdate: true, circle: C, gap: G }),
  { visible: ['settings', 'market', 'update'], extras: 1 },
  'progressive extras: drops from 2 to 1 before dropping pills',
);

assert.equal(capFooterPillExtras('settings', 2), 2);
assert.equal(capFooterPillExtras('market', 2), 2);
assert.equal(capFooterPillExtras('update', 2), 2);
assert.equal(capFooterPillExtras('market', 1), 1);

assert.equal(
  resolveFooterPillExpanded('update', ['settings', 'market', 'update']),
  'update',
);
assert.equal(resolveFooterPillExpanded('update', ['settings', 'market']), 'market');
assert.equal(resolveFooterPillExpanded('market', ['settings']), 'settings');

console.log('footerPillFit.test.ts: ok');
