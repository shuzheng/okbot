/**
 * Native <input type="file"> picker for gateway WebUI / HTTP attach
 * (no Electron dialog). Kept sync through input.click() so iOS Safari
 * treats it as a user gesture.
 *
 * Avoid display:none / visibility:hidden — some iOS versions ignore click()
 * on fully hidden file inputs; opacity + 1×1 clip is the usual workaround.
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
    // iOS Safari: keep a near-invisible input in the tree until change/cancel.
    input.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;overflow:hidden;' +
      'padding:0;margin:0;border:0;z-index:-1;pointer-events:none;';

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
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

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    document.body.appendChild(input);
    // Must stay synchronous with the originating click/tap.
    input.click();
  });
}
