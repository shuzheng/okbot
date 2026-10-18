import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  detectHostTimezone,
  listIanaTimezones,
  normalizeTimezone,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';

const AUTO_VALUE = '';

export function TimezoneCombobox({
  lang,
  value,
  onChange,
}: {
  lang: UiLang;
  /** Empty = auto-detect. */
  value: string;
  onChange: (next: string) => void;
}) {
  const normalized = normalizeTimezone(value);
  const hostTz = useMemo(() => detectHostTimezone(), []);
  const zones = useMemo(() => listIanaTimezones(), []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const width = Math.min(360, Math.max(rect.width, 260));
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxH = Math.min(280, openUp ? spaceAbove : spaceBelow);
      setPanelStyle({
        position: 'fixed',
        zIndex: 80,
        width,
        maxHeight: Math.max(160, maxH),
        left: Math.min(rect.right - width, window.innerWidth - width - 8),
        top: openUp ? undefined : rect.bottom + 4,
        bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      });
    };
    place();
    window.addEventListener('resize', place);
    // Capture scroll from settings body / ancestors.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const tmr = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(tmr);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) => z.toLowerCase().includes(q));
  }, [zones, query]);

  const triggerLabel = normalized
    ? normalized
    : t(lang, 'timezoneAuto', { zone: hostTz });

  const pick = (next: string) => {
    onChange(normalizeTimezone(next));
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="settings-timezone-combo" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-timezone-combo-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t(lang, 'timezone')}
        onClick={() => {
          setOpen((v) => !v);
          setQuery('');
        }}
      >
        <span className="settings-timezone-combo-trigger-text">{triggerLabel}</span>
        <span className="settings-timezone-combo-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="settings-timezone-combo-panel" role="listbox" style={panelStyle}>
          <input
            ref={searchRef}
            type="search"
            className="settings-timezone-combo-search"
            value={query}
            placeholder={t(lang, 'timezoneSearchPlaceholder')}
            aria-label={t(lang, 'timezoneSearchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!query.trim()) {
                  pick(AUTO_VALUE);
                  return;
                }
                if (filtered.length === 1) pick(filtered[0]!);
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                const first = listRef.current?.querySelector<HTMLButtonElement>(
                  'button.settings-timezone-combo-option',
                );
                first?.focus();
              }
            }}
          />
          <div className="settings-timezone-combo-list" ref={listRef}>
            {!query.trim() ? (
              <button
                type="button"
                role="option"
                className={
                  'settings-timezone-combo-option' +
                  (normalized === AUTO_VALUE ? ' is-selected' : '')
                }
                aria-selected={normalized === AUTO_VALUE}
                onClick={() => pick(AUTO_VALUE)}
              >
                {t(lang, 'timezoneAuto', { zone: hostTz })}
              </button>
            ) : null}
            {filtered.map((z) => (
              <button
                key={z}
                type="button"
                role="option"
                className={
                  'settings-timezone-combo-option' + (normalized === z ? ' is-selected' : '')
                }
                aria-selected={normalized === z}
                onClick={() => pick(z)}
              >
                {z}
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className="settings-timezone-combo-empty">{t(lang, 'timezoneNoMatch')}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
