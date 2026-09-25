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

/**
 * Session list last-updated label (expanded sidebar).
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
