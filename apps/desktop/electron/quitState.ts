/** When true, before-quit may tear down in-flight chats (and allow quitAndInstall). */
let allowQuit = false;

export function getAllowQuit(): boolean {
  return allowQuit;
}

export function setAllowQuit(next: boolean): void {
  allowQuit = next;
}
