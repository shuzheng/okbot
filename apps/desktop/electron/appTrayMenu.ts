/** Pure tray menu template (no Electron runtime) for tests and appTray. */

export type TraySessionEntry = {
  id: string;
  kind: 'bot' | 'squad';
  name: string;
  emoji: string;
};

export type AppTrayThemeMode = 'system' | 'light' | 'dark';

export type AppTrayLabels = {
  show: string;
  /** Section header above recent sessions (e.g. 最近会话). */
  recentSessions: string;
  /** Section header above pinned sessions (e.g. 置顶). */
  pinnedSessions: string;
  /** Theme submenu title (e.g. 主题). */
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  settings: string;
  quit: string;
  tooltip: string;
};

export type AppTrayCallbacks = {
  showWindow: () => void;
  openSession: (entry: TraySessionEntry) => void;
  openSettings: () => void;
  quitApp: () => void;
  /** Persist + apply settings.theme (tray theme submenu). */
  setTheme: (theme: AppTrayThemeMode) => void;
  /** Current settings.theme for radio checkmarks. */
  theme: AppTrayThemeMode;
  labels: AppTrayLabels;
  pinned: TraySessionEntry[];
  recent: TraySessionEntry[];
};

export type TrayMenuRadioItem = {
  label: string;
  type: 'radio';
  checked: boolean;
  click: () => void;
};

export type TrayMenuTemplateItem =
  | { label: string; click: () => void; type?: undefined; enabled?: true; submenu?: undefined }
  | { label: string; enabled: false; type?: undefined; click?: undefined; submenu?: undefined }
  | { type: 'separator'; label?: undefined; click?: undefined; enabled?: undefined; submenu?: undefined }
  | { label: string; submenu: TrayMenuRadioItem[]; type?: undefined; click?: undefined; enabled?: undefined };

const SQUAD_TRAY_EMOJI = '👥';
const BOT_TRAY_EMOJI_FALLBACK = '🤖';
/** Uniform stand-in for bot-avatar (3D / 立体) — native menus cannot paint 3D canvases. */
const BOT_AVATAR_TRAY_EMOJI = '👤';
const RECENT_LIMIT_DEFAULT = 10;

/**
 * Native Electron Tray menus cannot render bot-avatars 3D canvases.
 * When avatarKind is `bot-avatar` (立体), always show 👤 (not the bot's custom
 * emoji field). Emoji-kind avatars keep their own emoji.
 */
export function trayDisplayEmoji(input: {
  kind: 'bot' | 'squad';
  emoji?: string | null;
  avatarKind?: string | null;
}): string {
  if (input.kind === 'bot' && input.avatarKind === 'bot-avatar') {
    return BOT_AVATAR_TRAY_EMOJI;
  }
  const raw = (input.emoji || '').trim();
  if (raw) return raw;
  return input.kind === 'squad' ? SQUAD_TRAY_EMOJI : BOT_TRAY_EMOJI_FALLBACK;
}

export function traySessionLabel(entry: TraySessionEntry): string {
  const emoji = trayDisplayEmoji({ kind: entry.kind, emoji: entry.emoji });
  const name = (entry.name || '').trim() || entry.id;
  return `${emoji} ${name}`;
}

/**
 * Pinned strip order (settings.pinnedOwnerIds), then top N recent by updatedAt
 * excluding pinned + hidden. Squads use 👥 when no emoji.
 * For 3D/立体 (`bot-avatar`) bots, tray labels use 👤 (not custom emoji).
 */
export function collectTraySessions(input: {
  bots: Array<{
    id: string;
    name: string;
    emoji: string;
    updatedAt: string;
    /** When `bot-avatar` (立体), tray label uses 👤 — native menus cannot paint 3D. */
    avatarKind?: string;
  }>;
  squads: Array<{ id: string; name: string; updatedAt: string; emoji?: string }>;
  pinnedOwnerIds: string[];
  hiddenOwnerIds?: string[];
  recentLimit?: number;
}): { pinned: TraySessionEntry[]; recent: TraySessionEntry[] } {
  const hidden = new Set(input.hiddenOwnerIds || []);
  const byId = new Map<string, TraySessionEntry & { updatedAt: string }>();
  for (const b of input.bots) {
    byId.set(b.id, {
      id: b.id,
      kind: 'bot',
      name: b.name,
      emoji: trayDisplayEmoji({
        kind: 'bot',
        emoji: b.emoji,
        avatarKind: b.avatarKind,
      }),
      updatedAt: b.updatedAt || '',
    });
  }
  for (const s of input.squads) {
    byId.set(s.id, {
      id: s.id,
      kind: 'squad',
      name: s.name,
      emoji: trayDisplayEmoji({ kind: 'squad', emoji: s.emoji }),
      updatedAt: s.updatedAt || '',
    });
  }

  const pinned: TraySessionEntry[] = [];
  const pinnedIds = new Set<string>();
  for (const id of input.pinnedOwnerIds || []) {
    if (hidden.has(id)) continue;
    const row = byId.get(id);
    if (!row) continue;
    pinnedIds.add(id);
    pinned.push({ id: row.id, kind: row.kind, name: row.name, emoji: row.emoji });
  }

  const limit = Math.max(0, input.recentLimit ?? RECENT_LIMIT_DEFAULT);
  const recent = [...byId.values()]
    .filter((row) => !pinnedIds.has(row.id) && !hidden.has(row.id))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, limit)
    .map(({ id, kind, name, emoji }) => ({ id, kind, name, emoji }));

  return { pinned, recent };
}

export function buildTrayMenuTemplate(cb: AppTrayCallbacks): TrayMenuTemplateItem[] {
  const theme = cb.theme === 'light' || cb.theme === 'dark' ? cb.theme : 'system';
  const items: TrayMenuTemplateItem[] = [
    { label: cb.labels.show, click: () => cb.showWindow() },
    { type: 'separator' },
    {
      label: cb.labels.theme,
      submenu: [
        {
          label: cb.labels.themeSystem,
          type: 'radio',
          checked: theme === 'system',
          click: () => cb.setTheme('system'),
        },
        {
          label: cb.labels.themeLight,
          type: 'radio',
          checked: theme === 'light',
          click: () => cb.setTheme('light'),
        },
        {
          label: cb.labels.themeDark,
          type: 'radio',
          checked: theme === 'dark',
          click: () => cb.setTheme('dark'),
        },
      ],
    },
  ];

  if (cb.pinned.length > 0) {
    items.push({ type: 'separator' });
    items.push({ label: cb.labels.pinnedSessions, enabled: false });
    for (const entry of cb.pinned) {
      items.push({
        label: traySessionLabel(entry),
        click: () => cb.openSession(entry),
      });
    }
  }

  if (cb.recent.length > 0) {
    items.push({ type: 'separator' });
    items.push({ label: cb.labels.recentSessions, enabled: false });
    for (const entry of cb.recent) {
      items.push({
        label: traySessionLabel(entry),
        click: () => cb.openSession(entry),
      });
    }
  }

  items.push({ type: 'separator' });
  items.push({ label: cb.labels.settings, click: () => cb.openSettings() });
  items.push({ type: 'separator' });
  items.push({ label: cb.labels.quit, click: () => cb.quitApp() });
  return items;
}
