import { ATTACH_IMAGE_EXTENSIONS } from './dropAttachments';
import { isImageFileName } from './ownerUpload';

export type PastedFileItem = {
  file: File;
  name: string;
  kind: 'image' | 'file';
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

/**
 * Collect image/file items from a paste clipboard.
 * Skips plain text / html so normal typing paste still works when no files.
 */
export function collectPastedFiles(clipboardData: DataTransfer | null | undefined): PastedFileItem[] {
  if (!clipboardData) return [];
  const out: PastedFileItem[] = [];
  const seen = new Set<string>();

  const pushFile = (file: File | null | undefined, fallbackName?: string) => {
    if (!file || file.size <= 0) return;
    const name =
      (file.name && file.name.trim()) ||
      fallbackName ||
      (file.type?.startsWith('image/') ? `clipboard.${extFromMime(file.type)}` : 'clipboard.bin');
    const key = `${name}:${file.size}:${file.type}:${file.lastModified || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    const kind: 'image' | 'file' = isImageFileName(name, file.type) ? 'image' : 'file';
    // Reject non-image "image/*" that we don't support for vision? Keep as file if unknown.
    if (kind === 'image' && file.type && !file.type.startsWith('image/')) {
      /* still image by extension */
    }
    out.push({ file, name, kind });
  };

  const items = clipboardData.items;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || item.kind !== 'file') continue;
      pushFile(item.getAsFile());
    }
  }

  if (!out.length && clipboardData.files?.length) {
    for (const file of Array.from(clipboardData.files)) {
      pushFile(file);
    }
  }

  return out;
}

function extFromMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/bmp') return 'bmp';
  if (m === 'image/png') return 'png';
  if (ATTACH_IMAGE_EXTENSIONS.has(extOf(m))) return extOf(m);
  return 'png';
}

export function clipboardHasFiles(clipboardData: DataTransfer | null | undefined): boolean {
  return collectPastedFiles(clipboardData).length > 0;
}
