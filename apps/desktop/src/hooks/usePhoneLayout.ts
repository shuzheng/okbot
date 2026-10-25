import { useEffect, useState } from 'react';

/**
 * Session-list left sheet breakpoint (edge half-disk opener, not hamburger).
 * Desktop narrow (521–720 CSS px) keeps the docked icon rail via auto-collapse;
 * only true phone / very-narrow widths get the sheet.
 *
 * Use layout max-width:520 for shrunk desktop windows, AND max-device-width
 * + coarse pointer for real phones. iOS Safari can expand the *layout*
 * viewport past device-width when content min-width overflows (shrink-to-fit
 * chicken-egg) — matchMedia('(max-width: 520px)') then stays false forever
 * and the half-disk never appears. Device-width ignores that expansion.
 * Settings still uses its own ≤768 icon-rail / ≤640 hamburger (unchanged).
 * Match CSS @media for .app.phone-layout in app.css.
 */
export const PHONE_LAYOUT_MQ =
  '(max-width: 520px), ((max-device-width: 520px) and (hover: none) and (pointer: coarse))';

/** True when the viewport is phone-narrow (WebUI or a very shrunk window). */
export function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(PHONE_LAYOUT_MQ).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(PHONE_LAYOUT_MQ);
    const onChange = () => setPhone(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return phone;
}

/**
 * Keep --app-height / --vv-offset-top in sync with visualViewport so iOS Safari
 * soft keyboards and focus-scroll do not push the composer off-screen or leave
 * a black gap under a translated layout viewport (overflow:hidden alone is not
 * enough — Safari still pans scrollY / visualViewport.offsetTop on input focus).
 *
 * Pair with phone-layout CSS that pins .app to top:var(--vv-offset-top) and
 * height:var(--app-height).
 */
export function useVisualViewportAppHeight(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) return;

    let attached = false;

    const sync = () => {
      root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
      // Offset when the URL bar / keyboard / focus-pan shifts the visual viewport.
      root.style.setProperty('--vv-offset-top', `${Math.round(vv.offsetTop)}px`);
      // Kill document scroll iOS applies when focusing bottom inputs. Without
      // this, a fixed-height app slides up and leaves a gap above Safari chrome.
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    const attach = () => {
      if (attached) return;
      attached = true;
      sync();
      vv.addEventListener('resize', sync);
      vv.addEventListener('scroll', sync);
      window.addEventListener('resize', sync);
      window.addEventListener('scroll', sync, { passive: true });
    };

    const detach = () => {
      if (!attached) return;
      attached = false;
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync);
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--vv-offset-top');
    };

    // Desktop Electron window-drag already reflows heavily; these listeners only
    // matter for phone / coarse-pointer (iOS keyboard + visualViewport pan).
    const mq = window.matchMedia(PHONE_LAYOUT_MQ);
    const refresh = () => {
      if (mq.matches || prefersCoarsePointer()) attach();
      else detach();
    };
    refresh();
    mq.addEventListener('change', refresh);
    return () => {
      mq.removeEventListener('change', refresh);
      detach();
    };
  }, []);
}

/** True on touch / coarse-pointer phones — hover dock tips must not stick. */
export function prefersCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
