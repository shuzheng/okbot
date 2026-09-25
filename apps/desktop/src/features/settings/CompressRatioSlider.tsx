import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Liquid } from 'liquid-gooey';

const MIN_PCT = 50;
const MAX_PCT = 95;
const THUMB_PX = 24;

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return Math.round(((MIN_PCT + MAX_PCT) / 2));
  return Math.min(MAX_PCT, Math.max(MIN_PCT, Math.round(n)));
}

export function CompressRatioSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (pct: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const travel = Math.max(0, trackWidth - THUMB_PX);
  const pct = clampPct(value);
  const x = travel > 0 ? ((pct - MIN_PCT) / (MAX_PCT - MIN_PCT)) * travel : 0;

  const pctFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || travel <= 0) return pct;
      const rect = el.getBoundingClientRect();
      const rawX = clientX - rect.left - THUMB_PX / 2;
      const clampedX = Math.min(travel, Math.max(0, rawX));
      return clampPct(MIN_PCT + (clampedX / travel) * (MAX_PCT - MIN_PCT));
    },
    [travel, pct],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    onChange(pctFromClientX(e.clientX));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onChange(pctFromClientX(e.clientX));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onChange(pctFromClientX(e.clientX));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(clampPct(pct - 1));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(clampPct(pct + 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(MIN_PCT);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(MAX_PCT);
    }
  };

  return (
    <div className="compress-ratio-slider">
      <div
        ref={trackRef}
        className="compress-ratio-slider-track"
        role="slider"
        tabIndex={0}
        aria-valuemin={MIN_PCT}
        aria-valuemax={MAX_PCT}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div className="compress-ratio-slider-rail" aria-hidden />
        <Liquid
          className="compress-ratio-slider-liquid"
          fill="var(--muted)"
          filterPadding={28}
          style={{ width: '100%', height: THUMB_PX }}
        >
          <Liquid.Item effect="move" move={{ stretch: 0.6, trail: 0.35 }}>
            <div
              className="thumb"
              style={{
                width: THUMB_PX,
                height: THUMB_PX,
                transform: `translateX(${x}px)`,
              }}
            />
          </Liquid.Item>
        </Liquid>
      </div>
      <span className="compress-ratio-slider-value">{pct}%</span>
    </div>
  );
}
