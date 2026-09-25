import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hover/? help tip. Portaled to document.body so it is not clipped by
 * `.settings-shell` / `.settings-body` / `.settings-card` overflow.
 */
export function SettingsHelpTip({ text }: { text: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    place: 'below' | 'above';
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const tipW = Math.min(280, window.innerWidth * 0.62);
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - tipW - 8));
      const spaceBelow = window.innerHeight - r.bottom;
      const placeAbove = spaceBelow < 140 && r.top > 140;
      setPos({
        top: placeAbove ? r.top - 7 : r.bottom + 7,
        left,
        place: placeAbove ? 'above' : 'below',
      });
    };
    place();
    window.addEventListener('resize', place);
    // Capture scroll from nested settings panes.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return (
    <span
      className="settings-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setOpen(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className="settings-help-btn"
        aria-label={text}
        tabIndex={0}
      >
        ?
      </button>
      {open && pos
        ? createPortal(
            <span
              className={`settings-help-tip settings-help-tip-portal${
                pos.place === 'above' ? ' above' : ''
              }`}
              role="tooltip"
              style={{
                top: pos.top,
                left: pos.left,
                transform: pos.place === 'above' ? 'translateY(-100%)' : undefined,
              }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
