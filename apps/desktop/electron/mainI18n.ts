import { app } from 'electron';
import type { LanguageCode } from '@okbot/shared';

export type MainUiLang = 'zh' | 'en';

/** Resolve UI language for main-process dialogs (no renderer navigator). */
export function resolveMainUiLang(language: LanguageCode | undefined): MainUiLang {
  if (language === 'zh' || language === 'en') return language;
  const loc = (app.getLocale() || '').toLowerCase();
  if (loc.startsWith('zh')) return 'zh';
  return 'en';
}

type CloseDialogCopy = {
  message: string;
  detail: string;
  tray: string;
  quit: string;
  cancel: string;
  remember: string;
  trayShow: string;
  trayRecentSessions: string;
  trayPinnedSessions: string;
  trayTheme: string;
  trayThemeSystem: string;
  trayThemeLight: string;
  trayThemeDark: string;
  traySettings: string;
  trayQuit: string;
  trayTooltip: string;
};

const CLOSE_DIALOG: Record<MainUiLang, CloseDialogCopy> = {
  zh: {
    message: '关闭窗口时要做什么？',
    detail:
      '最小化到托盘后 OkBot 会在后台继续运行（对话与网关不停）。选择退出将结束应用。',
    tray: '最小化到托盘',
    quit: '退出',
    cancel: '取消',
    remember: '记住我的选择',
    trayShow: '打开窗口',
    trayRecentSessions: '最近会话',
    trayPinnedSessions: '置顶',
    trayTheme: '主题',
    trayThemeSystem: '跟随系统',
    trayThemeLight: '浅色',
    trayThemeDark: '深色',
    traySettings: '设置',
    trayQuit: '退出',
    trayTooltip: 'OkBot',
  },
  en: {
    message: 'What should happen when you close the window?',
    detail:
      'Minimize to tray keeps OkBot running in the background (chats and gateway stay up). Quit ends the app.',
    tray: 'Minimize to tray',
    quit: 'Quit',
    cancel: 'Cancel',
    remember: 'Remember my choice',
    trayShow: 'Open Window',
    trayRecentSessions: 'Recent Sessions',
    trayPinnedSessions: 'Pinned',
    trayTheme: 'Theme',
    trayThemeSystem: 'System',
    trayThemeLight: 'Light',
    trayThemeDark: 'Dark',
    traySettings: 'Settings',
    trayQuit: 'Quit',
    trayTooltip: 'OkBot',
  },
};

/** macOS: traffic-light close → hide to menu bar (same tray), wording differs. */
const CLOSE_DIALOG_MAC: Record<MainUiLang, Pick<CloseDialogCopy, 'detail' | 'tray'>> = {
  zh: {
    detail:
      '隐藏到菜单栏后 OkBot 会在后台继续运行（对话与网关不停）。选择退出将结束应用。Cmd+Q 会请求退出；若仍有任务在跑，会先转入后台。',
    tray: '隐藏到菜单栏',
  },
  en: {
    detail:
      'Hide to the menu bar keeps OkBot running in the background (chats and gateway stay up). Quit ends the app. Cmd+Q requests quit; if work is still in flight, OkBot moves to the background first.',
    tray: 'Hide to menu bar',
  },
};

export function closeDialogCopy(lang: MainUiLang): CloseDialogCopy {
  const base = CLOSE_DIALOG[lang];
  if (process.platform !== 'darwin') return base;
  const mac = CLOSE_DIALOG_MAC[lang];
  return { ...base, detail: mac.detail, tray: mac.tray };
}

export type BackgroundQuitCopy = {
  message: string;
  detailPending: (count: number) => string;
  detailBusy: string;
  wait: string;
  forceQuit: string;
};

const BACKGROUND_QUIT: Record<MainUiLang, BackgroundQuitCopy> = {
  zh: {
    message: '还有任务在后台等待',
    detailPending: (count) =>
      `有 ${count} 个工具审批未完成。选「退出并取消」后将无法继续批准。`,
    detailBusy: '还有对话正在生成。选「退出并取消」将中断这些任务。',
    wait: '继续等待',
    forceQuit: '退出并取消',
  },
  en: {
    message: 'Work is still running in the background',
    detailPending: (count) =>
      `${count} tool approval(s) are still open. “Quit and cancel” will discard them.`,
    detailBusy: 'A chat is still generating. “Quit and cancel” will interrupt those tasks.',
    wait: 'Keep waiting',
    forceQuit: 'Quit and cancel',
  },
};

export function backgroundQuitCopy(lang: MainUiLang): BackgroundQuitCopy {
  return BACKGROUND_QUIT[lang];
}


export type UpdateInstallDialogCopy = {
  readyMessage: string;
  readyDetail: (version: string) => string;
  restartNow: string;
  later: string;
  failedMessage: string;
  ok: string;
  notWritable: string;
  noSpace: string;
  noSha: string;
  genericFail: string;
  installFailFallback: string;
  /** Dev-mode check / download errors shown in updater status. */
  devNoCheck: string;
  devNoDownload: string;
};

const UPDATE_INSTALL: Record<MainUiLang, UpdateInstallDialogCopy> = {
  zh: {
    readyMessage: '更新已下载完成',
    readyDetail: (version) => `新版本 ${version} 已就绪。重启 OkBot 以完成安装。`,
    restartNow: '立即重启',
    later: '稍后',
    failedMessage: '无法安装更新',
    ok: '好',
    notWritable:
      '当前应用所在目录不可写（例如还在 DMG 里运行，或没有 /Applications 的写入权限）。请先把 OkBot 复制到「应用程序」后再更新。',
    noSpace: '磁盘空间不足，无法展开安装包。请腾出空间后重试。',
    noSha: '安装包校验信息不完整。请重新检查更新并下载。',
    genericFail: '已下载的安装包不在更新缓存里。请退出 OkBot，从 Release 手动安装。',
    installFailFallback: '安装程序未能启动，请稍后重试或手动安装。',
    devNoCheck: '开发模式下不检查更新',
    devNoDownload: '开发模式下无法下载更新',
  },
  en: {
    readyMessage: 'Update downloaded',
    readyDetail: (version) => `Version ${version} is ready. Restart OkBot to finish installing.`,
    restartNow: 'Restart now',
    later: 'Later',
    failedMessage: 'Could not install update',
    ok: 'OK',
    notWritable:
      'The app folder is not writable (for example you are still running from a DMG, or lack write access to /Applications). Copy OkBot to Applications, then update.',
    noSpace: 'Not enough disk space to unpack the update. Free some space and try again.',
    noSha: 'The update package is missing a checksum. Check for updates and download again.',
    genericFail: 'The downloaded package is not in the update cache. Quit OkBot and install manually from the Release.',
    installFailFallback: 'The installer did not start. Try again later or install manually.',
    devNoCheck: 'Update checks are disabled in development mode',
    devNoDownload: 'Updates cannot be downloaded in development mode',
  },
};

export function updateInstallDialogCopy(lang: MainUiLang): UpdateInstallDialogCopy {
  return UPDATE_INSTALL[lang];
}

export type RemoteGatewayFailureCopy = {
  retry: string;
  openSettings: string;
  quit: string;
  /** Appended under the technical detail so users know Settings is reachable. */
  hint: string;
};

const REMOTE_GATEWAY_FAILURE: Record<MainUiLang, RemoteGatewayFailureCopy> = {
  zh: {
    retry: '重试',
    openSettings: '打开设置',
    quit: '退出',
    hint: '可打开设置切换到本地网关或修改远程网关；不会在未确认时静默启动本地网关。',
  },
  en: {
    retry: 'Retry',
    openSettings: 'Open Settings',
    quit: 'Quit',
    hint: 'Open Settings to switch to Local or edit the remote gateway. OkBot will not start a local gateway without that choice.',
  },
};

export function remoteGatewayFailureCopy(lang: MainUiLang): RemoteGatewayFailureCopy {
  return REMOTE_GATEWAY_FAILURE[lang];
}
