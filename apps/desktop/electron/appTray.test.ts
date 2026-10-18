import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrayIconCandidates, pickTrayIconPath, trayResourcesDir } from './appTrayPaths';
import {
  buildTrayMenuTemplate,
  collectTraySessions,
  trayDisplayEmoji,
  traySessionLabel,
  type AppTrayCallbacks,
} from './appTrayMenu';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-tray-'));
assert.equal(pickTrayIconPath(tmp, 'darwin'), null, 'empty dir → no icon path (ensureAppTray must fail)');

const darwin = listTrayIconCandidates(tmp, 'darwin');
assert.ok(darwin[0]?.endsWith('trayTemplate.png'));
assert.ok(darwin.some((p) => p.endsWith('trayTemplate@2x.png')));

const win = listTrayIconCandidates(tmp, 'win32');
assert.ok(win.every((p) => !p.includes('trayTemplate')));
assert.ok(win[0]?.endsWith('icon.png'));

fs.writeFileSync(path.join(tmp, 'icon.png'), 'x');
assert.equal(pickTrayIconPath(tmp, 'win32'), path.join(tmp, 'icon.png'));
fs.writeFileSync(path.join(tmp, 'trayTemplate.png'), 't');
assert.equal(pickTrayIconPath(tmp, 'darwin'), path.join(tmp, 'trayTemplate.png'));

assert.ok(trayResourcesDir('/app/out/main').replace(/\\/g, '/').endsWith('resources'));

const repoRes = path.join(path.dirname(fileURLToPath(import.meta.url)), '../resources');
if (fs.existsSync(path.join(repoRes, 'trayTemplate.png'))) {
  assert.equal(pickTrayIconPath(repoRes, 'darwin'), path.join(repoRes, 'trayTemplate.png'));
}


{
  // 立体头像 (bot-avatar): tray always shows 👤, not the bot's custom emoji.
  assert.equal(
    trayDisplayEmoji({ kind: 'bot', emoji: '🧠', avatarKind: 'bot-avatar' }),
    '👤',
  );
  assert.equal(
    trayDisplayEmoji({ kind: 'bot', emoji: '', avatarKind: 'bot-avatar' }),
    '👤',
  );
  assert.equal(
    trayDisplayEmoji({ kind: 'bot', emoji: '✍️', avatarKind: 'emoji' }),
    '✍️',
  );
  const bots = [
    {
      id: 'bot_3d',
      name: '诸葛',
      emoji: '🧠',
      avatarKind: 'bot-avatar',
      updatedAt: '2026-01-05T00:00:00.000Z',
    },
  ];
  const { recent } = collectTraySessions({
    bots,
    squads: [],
    pinnedOwnerIds: [],
    recentLimit: 10,
  });
  assert.equal(recent[0]?.emoji, '👤');
  assert.equal(traySessionLabel(recent[0]!), '👤 诸葛');
}

{
  const bots = [
    { id: 'bot_a', name: '翻译助手', emoji: '🈯️', updatedAt: '2026-01-03T00:00:00.000Z' },
    { id: 'bot_b', name: '写手', emoji: '✍️', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'bot_c', name: '旧的', emoji: '🤖', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const squads = [
    { id: 'squad_1', name: '产品小队', updatedAt: '2026-01-04T00:00:00.000Z' },
  ];
  const { pinned, recent } = collectTraySessions({
    bots,
    squads,
    pinnedOwnerIds: ['bot_b', 'missing', 'squad_1'],
    hiddenOwnerIds: [],
    recentLimit: 10,
  });
  assert.deepEqual(
    pinned.map((p) => p.id),
    ['bot_b', 'squad_1'],
  );
  assert.equal(pinned[1]?.emoji, '👥');
  // recent excludes pinned; newest first
  assert.deepEqual(
    recent.map((r) => r.id),
    ['bot_a', 'bot_c'],
  );
  assert.equal(traySessionLabel(pinned[0]!), '✍️ 写手');
}

{
  const labels = {
    show: '打开窗口',
    recentSessions: '最近会话',
    pinnedSessions: '置顶',
    theme: '主题',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色',
    settings: '设置',
    quit: '退出',
    tooltip: 'OkBot',
  };
  const calls: string[] = [];
  const pinned = [{ id: 'bot_p', kind: 'bot' as const, name: '钉住', emoji: '📌' }];
  const recent = [{ id: 'bot_r', kind: 'bot' as const, name: '最近', emoji: '🕒' }];
  const cb: AppTrayCallbacks = {
    showWindow: () => calls.push('show'),
    openSession: (e) => calls.push(`open:${e.id}`),
    openSettings: () => calls.push('settings'),
    quitApp: () => calls.push('quit'),
    setTheme: (t) => calls.push(`theme:${t}`),
    theme: 'system',
    labels,
    pinned,
    recent,
  };
  const tmpl = buildTrayMenuTemplate(cb);
  assert.equal(tmpl[0]?.label, '打开窗口');
  assert.equal(tmpl[1]?.type, 'separator');
  assert.equal(tmpl[2]?.label, '主题');
  assert.ok(tmpl[2] && 'submenu' in tmpl[2] && tmpl[2].submenu);
  const themeSub = tmpl[2].submenu!;
  assert.equal(themeSub.length, 3);
  assert.equal(themeSub[0]?.label, '跟随系统');
  assert.equal(themeSub[0]?.checked, true);
  assert.equal(themeSub[1]?.label, '浅色');
  assert.equal(themeSub[1]?.checked, false);
  assert.equal(themeSub[2]?.label, '深色');
  assert.equal(tmpl[3]?.type, 'separator');
  assert.equal(tmpl[4]?.label, '置顶');
  assert.equal(tmpl[4]?.enabled, false);
  assert.equal(tmpl[5]?.label, '📌 钉住');
  assert.equal(tmpl[6]?.type, 'separator');
  assert.equal(tmpl[7]?.label, '最近会话');
  assert.equal(tmpl[7]?.enabled, false);
  assert.equal(tmpl[8]?.label, '🕒 最近');
  assert.equal(tmpl[9]?.type, 'separator');
  assert.equal(tmpl[10]?.label, '设置');
  assert.equal(tmpl[11]?.type, 'separator');
  assert.equal(tmpl[12]?.label, '退出');
  themeSub[1]?.click?.();
  tmpl[5]?.click?.();
  tmpl[8]?.click?.();
  tmpl[10]?.click?.();
  assert.deepEqual(calls, ['theme:light', 'open:bot_p', 'open:bot_r', 'settings']);
}

{
  // Empty roster: Open / Theme / Settings / Quit (separators between).
  const cb: AppTrayCallbacks = {
    showWindow: () => {},
    openSession: () => {},
    openSettings: () => {},
    quitApp: () => {},
    setTheme: () => {},
    theme: 'dark',
    labels: {
      show: 'Open Window',
      recentSessions: 'Recent',
      pinnedSessions: 'Pinned',
      theme: 'Theme',
      themeSystem: 'System',
      themeLight: 'Light',
      themeDark: 'Dark',
      settings: 'Settings',
      quit: 'Quit',
      tooltip: 'OkBot',
    },
    pinned: [],
    recent: [],
  };
  const tmpl = buildTrayMenuTemplate(cb);
  assert.equal(tmpl[0]?.label, 'Open Window');
  assert.equal(tmpl[1]?.type, 'separator');
  assert.equal(tmpl[2]?.label, 'Theme');
  assert.ok(tmpl[2] && 'submenu' in tmpl[2]);
  assert.equal(tmpl[2].submenu?.[2]?.checked, true); // dark
  assert.equal(tmpl[3]?.type, 'separator');
  assert.equal(tmpl[4]?.label, 'Settings');
  assert.equal(tmpl[5]?.type, 'separator');
  assert.equal(tmpl[6]?.label, 'Quit');
  assert.equal(tmpl.length, 7);
}

console.log('appTray.test.ts: ok');
