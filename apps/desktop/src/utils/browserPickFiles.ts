/**
 * Native <input type="file"> picker for gateway WebUI / HTTP attach
 * (no Electron dialog). Kept sync through input.click() / showPicker()
 * so iOS Safari treats it as a user gesture.
 *
 * Avoid display:none / visibility:hidden / pointer-events:none — iOS Safari
 * ignores programmatic click() on inputs that are fully non-interactive.
 * Opacity + 1×1 clip keeps the control "present" for WebKit.
 */

export type BrowserPickKind = 'image' | 'file';

const IMAGE_ACCEPT =
  'image/*,image/png,image/jpeg,image/jpg,image/gif,image/webp,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.bmp';

/** Open the OS/browser file picker; resolves to selected files (empty if canceled). */
export function pickBrowserFiles(kind: BrowserPickKind): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (kind === 'image') {
      input.accept = IMAGE_ACCEPT;
    }
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    // iOS Safari: keep a near-invisible but still "real" input in the tree
    // until change/cancel. Do NOT set pointer-events:none or z-index:-1 —
    // those make WebKit treat click()/showPicker() as non-user-activated.
    input.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;overflow:hidden;' +
      'clip:rect(0 0 0 0);clip-path:inset(50%);padding:0;margin:0;border:0;';

    let settled = false;
    let focusArmed = false;
    let focusArmTimer = 0;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      window.removeEventListener('focus', onWindowFocus);
      if (focusArmTimer) window.clearTimeout(focusArmTimer);
      try {
        input.remove();
      } catch {
        /* ignore */
      }
      resolve(files);
    };

    const onChange = () => {
      finish(Array.from(input.files ?? []));
    };
    const onCancel = () => finish([]);
    // iOS often skips the 'cancel' event when the sheet is dismissed. Arm
    // focus-fallback only after the sheet has had time to open, so an early
    // focus flicker cannot resolve empty while the user is still picking.
    const onWindowFocus = () => {
      if (!focusArmed || settled) return;
      window.setTimeout(() => {
        if (settled) return;
        finish(Array.from(input.files ?? []));
      }, 300);
    };

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    document.body.appendChild(input);
    // Must stay synchronous with the originating click/tap.
    try {
      const anyInput = input as HTMLInputElement & { showPicker?: () => void };
      if (typeof anyInput.showPicker === 'function') {
        anyInput.showPicker();
      } else {
        input.click();
      }
    } catch {
      input.click();
    }
    window.addEventListener('focus', onWindowFocus);
    focusArmTimer = window.setTimeout(() => {
      focusArmed = true;
    }, 500);
  });
}
