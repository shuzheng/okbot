/**
 * Electron session permission allowlist.
 * - notifications: renderer `systemNotify` (web Notification API) depends on this.
 * - media / mediaKeySystem: getUserMedia / VoiceBeam / MediaRecorder.
 * - speech-*: keep allowing if Chromium still asks (legacy).
 */
export function isAllowedSessionPermission(permission: string): boolean {
  const name = String(permission);
  return (
    permission === 'notifications' ||
    permission === 'media' ||
    permission === 'mediaKeySystem' ||
    /speech/i.test(name)
  );
}
