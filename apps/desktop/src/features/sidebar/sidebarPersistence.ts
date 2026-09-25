import type { Selection } from '../../types';
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
} from './sidebarConstants';

export function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem('okbot.sidebarWidth');
    if (!raw) return SIDEBAR_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
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
