import { ATTACH_IMAGE_EXTENSIONS, classifyAttachPath } from './dropAttachments';

export const MAX_COMPOSER_ATTACHMENTS = 10;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type UploadedAttachment = {
  kind: 'image' | 'file';
  path: string;
  name: string;
  size: number;
  mediaPath: string;
  assetRel: string;
};

export function formatBytes(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) {
    const kb = n / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} kB`;
  }
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function basenameOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) || norm : norm;
}

function extOf(name: string): string {
  const base = basenameOf(name);
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1).toLowerCase();
}

export function isImageFileName(name: string, mime?: string | null): boolean {
  if (mime && mime.toLowerCase().startsWith('image/')) return true;
  return ATTACH_IMAGE_EXTENSIONS.has(extOf(name));
}

/** Convert a Blob/File to base64 (no data: prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type UploadOwnerAttachmentPayload = {
  ownerId: string;
  name?: string;
  localPath?: string;
  dataBase64?: string;
  mime?: string;
};

export async function uploadOwnerAttachment(
  payload: UploadOwnerAttachmentPayload,
): Promise<{ ok: true; attachment: UploadedAttachment } | { ok: false; error: string }> {
  const fn = window.okbot?.uploadOwnerAttachment;
  if (typeof fn !== 'function') {
    return { ok: false, error: 'upload_unavailable' };
  }
  try {
    const res = await fn(payload);
    if (!res?.ok || !res.attachment) {
      return { ok: false, error: (res && 'error' in res && res.error) || 'upload_failed' };
    }
    return { ok: true, attachment: res.attachment };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Upload a browser File/Blob into gateway ~/.okbot/<owner>/uploads/. */
export async function uploadFileBlob(
  ownerId: string,
  file: File | Blob,
  opts?: { name?: string },
): Promise<{ ok: true; attachment: UploadedAttachment } | { ok: false; error: string }> {
  const name =
    opts?.name ||
    (file instanceof File && file.name ? file.name : '') ||
    (file.type?.startsWith('image/') ? 'clipboard.png' : 'clipboard.bin');
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'upload_too_large' };
  }
  if (file.size <= 0) {
    return { ok: false, error: 'empty_upload' };
  }
  const dataBase64 = await blobToBase64(file);
  return uploadOwnerAttachment({
    ownerId,
    name,
    dataBase64,
    mime: file.type || undefined,
  });
}

/** Upload a gateway-local absolute path (owns-server pick/drop). */
export async function uploadLocalPath(
  ownerId: string,
  localPath: string,
  opts?: { name?: string },
): Promise<{ ok: true; attachment: UploadedAttachment } | { ok: false; error: string }> {
  const kind = classifyAttachPath(localPath);
  if (kind === 'folder') {
    return { ok: false, error: 'folder_not_uploadable' };
  }
  return uploadOwnerAttachment({
    ownerId,
    name: opts?.name || basenameOf(localPath),
    localPath,
  });
}
