import type { Selection } from '../../types';
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  MAIN_COLLAPSE_AT,
} from './sidebarConstants';
import { PHONE_LAYOUT_MQ } from '../../hooks/usePhoneLayout';

export function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem('okbot.sidebarWidth');
    let n = SIDEBAR_DEFAULT;
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) n = parsed;
    }
    n = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
    // First paint before auto-collapse: a desktop-persisted wide sidebar on a
    // ~390px phone must not force the grid past the layout viewport (Safari
    // shrink-to-fit). Mirror App maxSidebarForWindow / collapse rules.
    if (typeof window !== 'undefined') {
      const winW = window.innerWidth;
      if (Number.isFinite(winW) && winW > 0) {
        const maxForWin = Math.max(SIDEBAR_MIN, winW - MAIN_COLLAPSE_AT - 5);
        n = Math.min(n, maxForWin);
        // Phone sheet (≤520 layout OR real phone device-width) — never paint a
        // wide persisted sidebar that can expand Safari's layout viewport.
        const phone =
          winW <= 520 ||
          (typeof window.matchMedia === 'function' &&
            window.matchMedia(PHONE_LAYOUT_MQ).matches);
        if (phone) n = SIDEBAR_MIN;
      }
    }
    return n;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

export function loadLastSelection(): Selection {
  try {
    const raw = localStorage.getItem('okbot.lastSelection');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: string; id?: string };
    if (parsed?.kind === 'bot' && typeof parsed.id === 'string' && parsed.id) {
      return { kind: 'bot', id: parsed.id };
    }
    if (parsed?.kind === 'squad' && typeof parsed.id === 'string' && parsed.id) {
      return { kind: 'squad', id: parsed.id };
    }
    // legacy key from 群聊 placeholder
    if (parsed?.kind === 'group' && typeof parsed.id === 'string' && parsed.id) {
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastSelection(selection: Selection) {
  try {
    if (!selection) {
      localStorage.removeItem('okbot.lastSelection');
      return;
    }
    localStorage.setItem('okbot.lastSelection', JSON.stringify(selection));
  } catch {
    /* ignore */
  }
}

export function loadImmersiveChat(): boolean {
  try {
    return localStorage.getItem('okbot.immersiveChat') === '1';
  } catch {
    return false;
  }
}

export function saveImmersiveChat(value: boolean) {
  try {
    if (value) localStorage.setItem('okbot.immersiveChat', '1');
    else localStorage.removeItem('okbot.immersiveChat');
  } catch {
    /* ignore */
  }
}

