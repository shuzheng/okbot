/** When true, before-quit may tear down in-flight chats (and allow quitAndInstall). */
let allowQuit = false;

/** True while the app is intentionally quitting (Cmd+Q, tray Quit, remembered quit-on-close). */
let isQuitting = false;

export function getAllowQuit(): boolean {
  return allowQuit;
}

export function setAllowQuit(next: boolean): void {
  allowQuit = next;
}

export function getIsQuitting(): boolean {
  return isQuitting;
}

export function setIsQuitting(next: boolean): void {
  isQuitting = next;
}
