import type { UiLang } from '../i18n';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function calendarDayDiff(from: Date, to: Date): number {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

function formatHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const ZH_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const;

/** Chat transcript: show a centered time label when gap exceeds this (strictly greater). */
export const MESSAGE_TIME_DIVIDER_GAP_MS = 5 * 60 * 1000;

/**
 * Session list last-updated label (expanded sidebar) and chat transcript time dividers.
 * Same day → HH:mm; yesterday → 昨天/Yesterday + time; within a week → weekday;
 * within a month → MM/DD; older → YYYY/MM/DD.
 */
export function formatSessionUpdatedAt(iso: string, lang: UiLang, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const dayDiff = calendarDayDiff(d, now);
  if (dayDiff < 0) {
    // Future clock skew: fall back to absolute date.
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  }
  if (dayDiff === 0) return formatHm(d);
  if (dayDiff === 1) {
    const y = lang === 'zh' ? '昨天' : 'Yesterday';
    return `${y} ${formatHm(d)}`;
  }
  if (dayDiff < 7) {
    if (lang === 'zh') return ZH_WEEKDAYS[d.getDay()] ?? '';
    return d.toLocaleDateString('en', { weekday: 'short' });
  }
  if (dayDiff < 30) {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  }
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

/**
 * Whether to show a time divider before `createdAt` relative to the previous
 * adjacent message in the rendered list (including after older pages prepend).
 * First message in the list → true (day/time context). Gap must be strictly
 * greater than MESSAGE_TIME_DIVIDER_GAP_MS.
 */
export function shouldShowMessageTimeDivider(
  previousCreatedAt: string | null | undefined,
  createdAt: string,
): boolean {
  const curr = new Date(createdAt).getTime();
  if (Number.isNaN(curr)) return false;
  if (previousCreatedAt == null || previousCreatedAt === '') return true;
  const prev = new Date(previousCreatedAt).getTime();
  if (Number.isNaN(prev)) return true;
  return curr - prev > MESSAGE_TIME_DIVIDER_GAP_MS;
}

/**
 * Local clock for swipe-to-reveal on transcript rows.
 * Always HH:MM from `createdAt` — not the session relative label.
 */
export function formatMessageClockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatHm(d);
}
