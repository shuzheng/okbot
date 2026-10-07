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
    trayShow: '打开 OkBot',
    trayQuit: '退出 OkBot',
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
    trayShow: 'Open OkBot',
    trayQuit: 'Quit OkBot',
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
