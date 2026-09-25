import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bot } from '@okbot/shared';
import { FlatAvatar } from '../../components/ui/avatars';
import { SearchIcon } from '../../components/ui/icons';
import { t } from '../../i18n';

export function BotSearchSelect({
  bots,
  lang,
  multi,
  values,
  onChange,
  excludeIds = [],
  placeholder,
  /** When "none", trigger stays placeholder-only (no chips); picks append. Ideal for roster UIs. */
  selectedDisplay = 'chips',
}: {
  bots: Bot[];
  lang: 'zh' | 'en';
  multi: boolean;
  values: string[];
  onChange: (next: string[]) => void;
  excludeIds?: string[];
  placeholder: string;
  selectedDisplay?: 'chips' | 'none';
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hideSelected = selectedDisplay === 'none';
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);
  const selectedSet = useMemo(() => new Set(values), [values]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return bots.filter((b) => {
      if (exclude.has(b.id)) return false;
      if (hideSelected && selectedSet.has(b.id)) return false;
      if (!needle) return true;
      return b.name.toLowerCase().includes(needle);
    });
  }, [bots, exclude, hideSelected, selectedSet, q]);
  const selectedBots = useMemo(
    () => values.map((id) => bots.find((b) => b.id === id)).filter(Boolean) as Bot[],
    [values, bots],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function toggle(id: string) {
    if (hideSelected) {
      if (!selectedSet.has(id)) onChange([...values, id]);
      setQ('');
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (multi) {
      if (selectedSet.has(id)) onChange(values.filter((x) => x !== id));
      else onChange([...values, id]);
    } else {
      onChange([id]);
      setOpen(false);
    }
  }

  const showPlaceholder = hideSelected || selectedBots.length === 0;

  return (
    <div className={`bot-picker${open ? ' open' : ''}${hideSelected ? ' bot-picker-add' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="bot-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {showPlaceholder ? (
          <span className="bot-picker-placeholder">{placeholder}</span>
        ) : multi ? (
          <span className="bot-picker-chips">
            {selectedBots.map((b) => (
              <span key={b.id} className="bot-picker-chip">
                <FlatAvatar
                  emoji={b.emoji}
                  color={b.color}
                  avatarKind={b.avatarKind}
                  botAvatarType={b.botAvatarType}
                  className="bot-picker-chip-avatar"
                />
                <span>{b.name}</span>
                <span
                  className="bot-picker-chip-x"
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(values.filter((x) => x !== b.id));
                  }}
                >
                  ×
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="bot-picker-one">
            <FlatAvatar
              emoji={selectedBots[0]!.emoji}
              color={selectedBots[0]!.color}
              avatarKind={selectedBots[0]!.avatarKind}
              botAvatarType={selectedBots[0]!.botAvatarType}
              className="bot-picker-chip-avatar"
            />
            <span>{selectedBots[0]!.name}</span>
          </span>
        )}
        <span className="bot-picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="bot-picker-menu">
          <input
            ref={inputRef}
            spellCheck={false}
            className="bot-picker-search"
            placeholder={t(lang, 'squadSearchBot')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <div className="bot-picker-list">
            {filtered.length === 0 ? (
              <div className="bot-picker-empty">{t(lang, 'squadNoBotMatch')}</div>
            ) : (
              filtered.map((b) => {
                const on = !hideSelected && selectedSet.has(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`bot-picker-option${on ? ' selected' : ''}`}
                    onClick={() => toggle(b.id)}
                  >
                    <FlatAvatar
                  emoji={b.emoji}
                  color={b.color}
                  avatarKind={b.avatarKind}
                  botAvatarType={b.botAvatarType}
                  className="bot-picker-chip-avatar"
                />
                    <span className="bot-picker-option-name">{b.name}</span>
                    {on ? <span className="bot-picker-check">✓</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

