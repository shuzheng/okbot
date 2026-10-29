import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type SlidingPillTabOption<T extends string> = {
  id: T;
  label: ReactNode;
};

/**
 * Sliding-pill tab track — same chrome as Market「助手 / 连接器」and owner-form tabs
 * (.marketplace-tabs-track / .marketplace-tabs-pill).
 */
export function SlidingPillTabs<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  className,
}: {
  ariaLabel: string;
  value: T;
  options: SlidingPillTabOption<T>[];
  onChange: (id: T) => void;
  /** Extra class on the outer wrapper (default layout: sliding-pill-tabs). */
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const [pill, setPill] = useState({ left: 0, width: 0 });

  const syncPill = useCallback(() => {
    const track = trackRef.current;
    const btn = btnRefs.current[value];
    if (!track || !btn) return;
    const trackBox = track.getBoundingClientRect();
    const btnBox = btn.getBoundingClientRect();
    setPill({
      left: btnBox.left - trackBox.left + track.scrollLeft,
      width: btnBox.width,
    });
  }, [value]);

  useLayoutEffect(() => {
    btnRefs.current[value]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    syncPill();
  }, [syncPill, value, options]);

  useEffect(() => {
    const onResize = () => syncPill();
    window.addEventListener('resize', onResize);
    const track = trackRef.current;
    track?.addEventListener('scroll', onResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      track?.removeEventListener('scroll', onResize);
    };
  }, [syncPill]);

  return (
    <div
      className={['sliding-pill-tabs', className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
    >
      <div className="marketplace-tabs-track" ref={trackRef}>
        <span
          className="marketplace-tabs-pill"
          aria-hidden
          style={{
            transform: `translateX(${pill.left}px)`,
            width: pill.width ? `${pill.width}px` : undefined,
            opacity: pill.width ? 1 : 0,
          }}
        />
        {options.map((opt) => (
          <button
            key={opt.id}
            ref={(el) => {
              btnRefs.current[opt.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={value === opt.id}
            className={value === opt.id ? 'active' : ''}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
