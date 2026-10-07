import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  addTokenUsage,
  emptyTokenUsage,
  normalizeUsageStats,
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

/** Never read `.input` on a missing token bag (gateway payloads can omit a day or lifetime). */
function tokenOrEmpty(raw: TokenUsage | undefined | null): TokenUsage {
  if (!raw || typeof raw !== 'object') return emptyTokenUsage();
  return {
    input: Number.isFinite(raw.input) ? raw.input : 0,
    output: Number.isFinite(raw.output) ? raw.output : 0,
    cache: Number.isFinite(raw.cache) ? raw.cache : 0,
  };
}

type DayPoint = { day: string; input: number; output: number; cache: number };

/**
 * Empty selection is the 「全部」 chip. Selecting every listed assistant/squad
 * is the same set from the user's point of view, so both must use the overall
 * totals (`daily` / `lifetime`) rather than summing per-owner rows.
 * Per-owner rows omit deleted assistants (kept on the overall totals) and any
 * day recorded before `dailyByOwner` existed.
 */
function showsOverallUsage(selectedIds: string[], optionIds: string[]): boolean {
  if (selectedIds.length === 0) return true;
  if (selectedIds.length !== optionIds.length) return false;
  const options = new Set(optionIds);
  return selectedIds.every((id) => options.has(id));
}

function buildDailySeries(stats: UsageStats, ownerIds: string[], days = 14): DayPoint[] {
  const out: DayPoint[] = [];
  const now = new Date();
  const filter = ownerIds.length > 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let u = emptyTokenUsage();
    if (!filter) {
      u = tokenOrEmpty(stats.daily?.[key]);
    } else {
      for (const id of ownerIds) {
        const dayMap = stats.dailyByOwner?.[id];
        const day = dayMap ? tokenOrEmpty(dayMap[key]) : emptyTokenUsage();
        if (dayMap?.[key]) u = addTokenUsage(u, day);
      }
    }
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

  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ index: number } | null>(null);

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const scaleX = w / rect.width;
    const x = (e.clientX - rect.left) * scaleX;
    if (series.length === 0) {
      setHover(null);
      return;
    }
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < series.length; i++) {
      const dist = Math.abs(xAt(i) - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    // Only show when pointer is near the plot area.
    const y = (e.clientY - rect.top) * (h / rect.height);
    if (y < pad.t - 8 || y > pad.t + innerH + 8 || bestDist > innerW / Math.max(series.length, 1)) {
      setHover(null);
      return;
    }
    setHover({ index: best });
  }

  const tipPoint = hover ? series[hover.index] : null;
  // Viewport coords + portal: avoid clipping by .settings-card / .settings-body overflow
  // (far-right day points were half-cut with absolute positioning inside the card).
  const tipStyle =
    hover && wrapRef.current
      ? (() => {
          const svg = wrapRef.current!.querySelector('svg');
          const svgRect = svg?.getBoundingClientRect() ?? wrapRef.current!.getBoundingClientRect();
          const scaleX = svgRect.width / w;
          let left = svgRect.left + xAt(hover.index) * scaleX;
          const top = svgRect.top + pad.t * (svgRect.height / h);
          const tipHalf = 72;
          left = Math.min(Math.max(tipHalf + 8, left), window.innerWidth - tipHalf - 8);
          return { left, top };
        })()
      : null;

  return (
    <div className="usage-chart-wrap" ref={wrapRef}>
      <div className="usage-chart-svg-wrap">
        <svg
          className="usage-chart"
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={t(lang, 'usageDailyChart')}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
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
          {hover && tipPoint ? (
            <line
              x1={xAt(hover.index)}
              y1={pad.t}
              x2={xAt(hover.index)}
              y2={pad.t + innerH}
              stroke="currentColor"
              opacity="0.25"
              strokeDasharray="3 3"
            />
          ) : null}
          {hover && tipPoint
            ? (['input', 'output', 'cache'] as const).map((k) => (
                <circle
                  key={k}
                  cx={xAt(hover.index)}
                  cy={yAt(tipPoint[k])}
                  r={3.5}
                  fill={
                    k === 'input'
                      ? 'var(--usage-input, #6366f1)'
                      : k === 'output'
                        ? 'var(--usage-output, #22c55e)'
                        : 'var(--usage-cache, #f59e0b)'
                  }
                />
              ))
            : null}
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
        {hover && tipPoint && tipStyle
          ? createPortal(
              <div
                className="usage-chart-tip usage-chart-tip-portal"
                style={{ left: tipStyle.left, top: tipStyle.top }}
              >
                <div className="usage-chart-tip-day">{tipPoint.day}</div>
                <div className="usage-chart-tip-row input">
                  <span className="k">{t(lang, 'usageInput')}</span>
                  <span className="v">{formatTokens(tipPoint.input)}</span>
                </div>
                <div className="usage-chart-tip-row output">
                  <span className="k">{t(lang, 'usageOutput')}</span>
                  <span className="v">{formatTokens(tipPoint.output)}</span>
                </div>
                <div className="usage-chart-tip-row cache">
                  <span className="k">{t(lang, 'usageCache')}</span>
                  <span className="v">{formatTokens(tipPoint.cache)}</span>
                </div>
                <div className="usage-chart-tip-row">
                  <span className="k">{t(lang, 'usageSum')}</span>
                  <span className="v">{formatTokens(sumUsage(tipPoint))}</span>
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>
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
  const [selectedOwnerIds, setSelectedOwnerIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void window.okbot
      .getUsageStats()
      .then((s) => {
        if (!cancelled) setStats(normalizeUsageStats(s));
      })
      .catch((err) => {
        if (!cancelled) toast.error(formatSystemError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const members = useMemo(() => {
    if (!stats) return [];
    const rows: Array<{ id: string; name: string; kind: 'bot' | 'squad'; usage: TokenUsage }> = [];
    for (const b of bots) {
      const u = tokenOrEmpty(stats.byOwner?.[b.id]);
      if (stats.byOwner?.[b.id] && sumUsage(u) > 0) rows.push({ id: b.id, name: b.name, kind: 'bot', usage: u });
    }
    for (const s of squads) {
      const u = tokenOrEmpty(stats.byOwner?.[s.id]);
      if (stats.byOwner?.[s.id] && sumUsage(u) > 0) rows.push({ id: s.id, name: s.name, kind: 'squad', usage: u });
    }
    rows.sort((a, b) => sumUsage(b.usage) - sumUsage(a.usage));
    return rows;
  }, [stats, bots, squads]);

  const filterOptions = members;
  const overall = showsOverallUsage(
    selectedOwnerIds,
    filterOptions.map((m) => m.id),
  );

  const series = useMemo(
    () => (stats ? buildDailySeries(stats, overall ? [] : selectedOwnerIds, 14) : []),
    [stats, selectedOwnerIds, overall],
  );

  function toggleOwner(id: string) {
    setSelectedOwnerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const lifetime = useMemo(() => {
    if (!stats) return emptyTokenUsage();
    if (overall) return tokenOrEmpty(stats.lifetime);
    let u = emptyTokenUsage();
    for (const id of selectedOwnerIds) {
      const o = stats.byOwner?.[id];
      if (o) u = addTokenUsage(u, tokenOrEmpty(o));
    }
    return u;
  }, [stats, selectedOwnerIds, overall]);

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
        {filterOptions.length > 0 ? (
          <div className="usage-filter-bar">
            <p className="usage-filter-hint">{t(lang, 'usageChartFilterHint')}</p>
            <div className="usage-filter" role="group" aria-label={t(lang, 'usageChartFilter')}>
              <button
                type="button"
                className={`usage-filter-chip${selectedOwnerIds.length === 0 ? ' on' : ''}`}
                onClick={() => setSelectedOwnerIds([])}
              >
                {t(lang, 'usageChartFilterAll')}
              </button>
              {filterOptions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`usage-filter-chip${selectedOwnerIds.includes(m.id) ? ' on' : ''}`}
                  onClick={() => toggleOwner(m.id)}
                >
                  {m.name}
                  <span style={{ opacity: 0.55, marginLeft: 4 }}>
                    {m.kind === 'squad' ? t(lang, 'usageKindSquad') : t(lang, 'usageKindBot')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
            <li className="usage-member-row usage-member-head" aria-hidden="false">
              <span className="usage-member-name">{t(lang, 'usageMemberName')}</span>
              <span className="usage-member-nums">
                <span>{t(lang, 'usageInput')}</span>
                <span>{t(lang, 'usageOutput')}</span>
                <span>{t(lang, 'usageCache')}</span>
              </span>
            </li>
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
