import assert from 'node:assert/strict';
// Fixtures use +08:00 wall times; pin TZ so CI (UTC) matches local expectations.
process.env.TZ = 'Asia/Shanghai';
import {
  formatMessageClockTime,
  formatSessionUpdatedAt,
  MESSAGE_TIME_DIVIDER_GAP_MS,
  shouldShowMessageTimeDivider,
} from './formatSessionUpdatedAt';

const now = new Date('2026-10-14T15:30:00+08:00');

// Same day → HH:mm
assert.equal(formatSessionUpdatedAt('2026-10-14T08:05:00+08:00', 'zh', now), '08:05');
assert.equal(formatSessionUpdatedAt('2026-10-14T08:05:00+08:00', 'en', now), '08:05');

// Yesterday
assert.equal(formatSessionUpdatedAt('2026-10-13T21:00:00+08:00', 'zh', now), '昨天 21:00');
assert.equal(formatSessionUpdatedAt('2026-10-13T21:00:00+08:00', 'en', now), 'Yesterday 21:00');

// Within a week → weekday (2026-10-12 is Monday)
assert.equal(formatSessionUpdatedAt('2026-10-12T10:00:00+08:00', 'zh', now), '星期一');

// Within a month → MM/DD
assert.equal(formatSessionUpdatedAt('2026-09-20T10:00:00+08:00', 'zh', now), '09/20');

// Older → YYYY/MM/DD
assert.equal(formatSessionUpdatedAt('2026-08-01T10:00:00+08:00', 'zh', now), '2026/08/01');

// Invalid
assert.equal(formatSessionUpdatedAt('not-a-date', 'zh', now), '');

// Divider: first message
assert.equal(shouldShowMessageTimeDivider(null, '2026-10-14T12:00:00.000Z'), true);
assert.equal(shouldShowMessageTimeDivider(undefined, '2026-10-14T12:00:00.000Z'), true);
assert.equal(shouldShowMessageTimeDivider('', '2026-10-14T12:00:00.000Z'), true);

// Divider: exactly 5 minutes → no (strictly greater)
const t0 = '2026-10-14T12:00:00.000Z';
const tExact = new Date(Date.parse(t0) + MESSAGE_TIME_DIVIDER_GAP_MS).toISOString();
const tOver = new Date(Date.parse(t0) + MESSAGE_TIME_DIVIDER_GAP_MS + 1).toISOString();
const tUnder = new Date(Date.parse(t0) + MESSAGE_TIME_DIVIDER_GAP_MS - 1).toISOString();
assert.equal(shouldShowMessageTimeDivider(t0, tExact), false);
assert.equal(shouldShowMessageTimeDivider(t0, tOver), true);
assert.equal(shouldShowMessageTimeDivider(t0, tUnder), false);

// Adjacent after older page prepend: compare consecutive rendered timestamps
assert.equal(
  shouldShowMessageTimeDivider('2026-10-14T11:00:00.000Z', '2026-10-14T11:04:00.000Z'),
  false,
);
assert.equal(
  shouldShowMessageTimeDivider('2026-10-14T11:00:00.000Z', '2026-10-14T11:06:00.000Z'),
  true,
);

// Invalid current → no divider
assert.equal(shouldShowMessageTimeDivider(t0, 'bad'), false);

// Swipe-reveal clock: always local HH:MM (not relative session label)
assert.equal(formatMessageClockTime('2026-10-13T21:00:00+08:00'), '21:00');
assert.equal(formatMessageClockTime('2026-10-14T08:05:00+08:00'), '08:05');
assert.equal(formatMessageClockTime('not-a-date'), '');

console.log('formatSessionUpdatedAt.test.ts: ok');

