import { useEffect, useMemo, useState } from 'react';
import {
  emptyTokenUsage,
  type Bot,
  type Squad,
  type TokenUsage,
  type UsageStats,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { toast } from '../../components/ui';
import { formatSystemError } from '../../utils/formatSystemError';

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function sumUsage(u: TokenUsage): number {
  return (u.input || 0) + (u.output || 0) + (u.cache || 0);
}

type DayPoint = { day: string; input: number; output: number; cache: number };

function buildDailySeries(stats: UsageStats, days = 14): DayPoint[] {
  const out: DayPoint[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const u = stats.daily[key] ?? emptyTokenUsage();
    out.push({ day: key, input: u.input, output: u.output, cache: u.cache });
  }
  return out;
}

function UsageLineChart({ series, lang }: { series: DayPoint[]; lang: UiLang }) {
  const w = 520;
  const h = 160;
  const pad = { t: 12, r: 12, b: 24, l: 36 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const maxY = Math.max(
    1,
    ...series.flatMap((p) => [p.input, p.output, p.cache]),
  );
  const xAt = (i: number) =>
    pad.l + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - (v / maxY) * innerH;

  const pathFor = (key: 'input' | 'output' | 'cache') =>
    series
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p[key]).toFixed(1)}`)
      .join(' ');

  return (
    <div className="usage-chart-wrap">
      <svg className="usage-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t(lang, 'usageDailyChart')}>
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + innerH} stroke="currentColor" opacity="0.2" />
        <line
          x1={pad.l}
          y1={pad.t + innerH}
          x2={pad.l + innerW}
          y2={pad.t + innerH}
          stroke="currentColor"
          opacity="0.2"
        />
        <path d={pathFor('input')} fill="none" stroke="var(--usage-input, #6366f1)" strokeWidth="2" />
        <path d={pathFor('output')} fill="none" stroke="var(--usage-output, #22c55e)" strokeWidth="2" />
        <path d={pathFor('cache')} fill="none" stroke="var(--usage-cache, #f59e0b)" strokeWidth="2" />
        <text x={pad.l - 4} y={pad.t + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.55">
          {formatTokens(maxY)}
        </text>
        <text
          x={pad.l - 4}
          y={pad.t + innerH}
          textAnchor="end"
          fontSize="10"
          fill="currentColor"
          opacity="0.55"
        >
          0
        </text>
        {series.length > 0 ? (
          <>
            <text
              x={pad.l}
              y={h - 6}
              textAnchor="start"
              fontSize="10"
              fill="currentColor"
              opacity="0.55"
            >
              {series[0]!.day.slice(5)}
            </text>
            <text
              x={pad.l + innerW}
              y={h - 6}
              textAnchor="end"
              fontSize="10"
              fill="currentColor"
              opacity="0.55"
            >
              {series[series.length - 1]!.day.slice(5)}
            </text>
          </>
        ) : null}
      </svg>
      <div className="usage-legend">
        <span className="usage-legend-item input">{t(lang, 'usageInput')}</span>
        <span className="usage-legend-item output">{t(lang, 'usageOutput')}</span>
        <span className="usage-legend-item cache">{t(lang, 'usageCache')}</span>
      </div>
    </div>
  );
}

export function UsagePanel({
  lang,
  bots,
  squads,
}: {
  lang: UiLang;
  bots: Bot[];
  squads: Squad[];
}) {
  const [stats, setStats] = useState<UsageStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.okbot
      .getUsageStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((err) => {
        if (!cancelled) toast.error(formatSystemError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const series = useMemo(() => (stats ? buildDailySeries(stats, 14) : []), [stats]);

  const members = useMemo(() => {
    if (!stats) return [];
    const rows: Array<{ id: string; name: string; kind: 'bot' | 'squad'; usage: TokenUsage }> = [];
    for (const b of bots) {
      const u = stats.byOwner[b.id];
      if (u && sumUsage(u) > 0) rows.push({ id: b.id, name: b.name, kind: 'bot', usage: u });
    }
    for (const s of squads) {
      const u = stats.byOwner[s.id];
      if (u && sumUsage(u) > 0) rows.push({ id: s.id, name: s.name, kind: 'squad', usage: u });
    }
    rows.sort((a, b) => sumUsage(b.usage) - sumUsage(a.usage));
    return rows;
  }, [stats, bots, squads]);

  const lifetime = stats?.lifetime ?? emptyTokenUsage();

  return (
    <div>
      <div className="settings-section-label" data-settings-id="usageTotal">
        {t(lang, 'usageTotal')}
      </div>
      <div className="settings-card usage-total-card">
        <div className="usage-total-grid">
          <div>
            <div className="usage-metric-label">{t(lang, 'usageInput')}</div>
            <div className="usage-metric-value">{formatTokens(lifetime.input)}</div>
          </div>
          <div>
            <div className="usage-metric-label">{t(lang, 'usageOutput')}</div>
            <div className="usage-metric-value">{formatTokens(lifetime.output)}</div>
          </div>
          <div>
            <div className="usage-metric-label">{t(lang, 'usageCache')}</div>
            <div className="usage-metric-value">{formatTokens(lifetime.cache)}</div>
          </div>
          <div>
            <div className="usage-metric-label">{t(lang, 'usageSum')}</div>
            <div className="usage-metric-value">{formatTokens(sumUsage(lifetime))}</div>
          </div>
        </div>
      </div>

      <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="usageDailyChart">
        {t(lang, 'usageDailyChart')}
      </div>
      <div className="settings-card">
        <UsageLineChart series={series} lang={lang} />
      </div>

      <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="usageByMember">
        {t(lang, 'usageByMember')}
      </div>
      <div className="settings-card">
        {members.length === 0 ? (
          <div className="settings-hint">{t(lang, 'usageEmpty')}</div>
        ) : (
          <ul className="usage-member-list">
            {members.map((m) => (
              <li key={m.id} className="usage-member-row">
                <span className="usage-member-name">
                  {m.name}
                  <span className="usage-member-kind">
                    {m.kind === 'squad' ? t(lang, 'usageKindSquad') : t(lang, 'usageKindBot')}
                  </span>
                </span>
                <span className="usage-member-nums">
                  <span title={t(lang, 'usageInput')}>{formatTokens(m.usage.input)}</span>
                  <span title={t(lang, 'usageOutput')}>{formatTokens(m.usage.output)}</span>
                  <span title={t(lang, 'usageCache')}>{formatTokens(m.usage.cache)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
