import { useCallback, useRef, useState } from 'react';
import type { ComposerAttachment } from '../ChatComposer';
import type { AttachKind } from '../ComposerAttachMenu';
import {
  collectDroppedAttachments,
  dataTransferHasFiles,
  type DroppedAttachment,
} from '../../../utils/dropAttachments';
import { collectPastedFiles } from '../../../utils/pasteAttachments';
import {
  MAX_COMPOSER_ATTACHMENTS,
  basenameOf,
  uploadFileBlob,
  uploadLocalPath,
} from '../../../utils/ownerUpload';
import { formatSystemError } from '../../../utils/formatSystemError';
import { toast } from '../../../components/ui';
import { t, type UiLang } from '../../../i18n';

/**
 * Composer attachments + chat-area file drag/drop + clipboard paste.
 * Image/file bytes are copied to the gateway host ~/.okbot/<ownerId>/uploads/
 * so multi-computer clients never rely on client-local file:// paths.
 * Folder picks stay as gateway-local directory path references.
 */
export function useAttachments(opts: {
  lang: UiLang;
  listening: boolean;
  ownerId: string | null;
}) {
  const { lang, listening, ownerId } = opts;
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const fileDragDepthRef = useRef(0);
  const [fileDragOver, setFileDragOver] = useState(false);
  const uploadingRef = useRef(false);

  const updateAttachments = (next: ComposerAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const revokePreview = (att: ComposerAttachment) => {
    if (att.previewUrl && att.previewUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(att.previewUrl);
      } catch {
        /* ignore */
      }
    }
  };

  const roomLeft = () => Math.max(0, MAX_COMPOSER_ATTACHMENTS - attachmentsRef.current.length);

  const toastCap = () => {
    toast.info(t(lang, 'attachMaxReached', { max: String(MAX_COMPOSER_ATTACHMENTS) }));
  };

  const pushAttachment = (att: ComposerAttachment) => {
    const prev = attachmentsRef.current;
    if (prev.some((a) => a.path && att.path && a.path === att.path)) return false;
    if (prev.length >= MAX_COMPOSER_ATTACHMENTS) {
      revokePreview(att);
      toastCap();
      return false;
    }
    updateAttachments([...prev, att]);
    return true;
  };

  const addFolderPath = (filePath: string, name?: string) => {
    const path = filePath.trim();
    if (!path) return;
    pushAttachment({
      id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'folder',
      path,
      name: name || basenameOf(path),
    });
  };

  const uploadAndAdd = async (input: {
    localPath?: string;
    file?: File | Blob;
    name?: string;
    previewUrl?: string;
  }) => {
    const id = ownerId?.trim() || '';
    if (!id) {
      toast.error(t(lang, 'attachNeedSession'));
      if (input.previewUrl?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(input.previewUrl);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (roomLeft() <= 0) {
      toastCap();
      if (input.previewUrl?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(input.previewUrl);
        } catch {
          /* ignore */
        }
      }
      return;
    }

    let result:
      | { ok: true; attachment: {
          kind: 'image' | 'file';
          path: string;
          name: string;
          size: number;
          mediaPath: string;
          assetRel: string;
        } }
      | { ok: false; error: string };

    if (input.localPath) {
      result = await uploadLocalPath(id, input.localPath, { name: input.name });
    } else if (input.file) {
      result = await uploadFileBlob(id, input.file, { name: input.name });
    } else {
      return;
    }

    if (!result.ok) {
      if (input.previewUrl?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(input.previewUrl);
        } catch {
          /* ignore */
        }
      }
      if (result.error === 'upload_too_large') {
        toast.error(t(lang, 'attachTooLarge'));
      } else {
        toast.error(formatSystemError(result.error));
      }
      return;
    }

    const saved = result.attachment;
    pushAttachment({
      id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: saved.kind,
      path: saved.path,
      name: saved.name,
      size: saved.size,
      mediaPath: saved.mediaPath,
      previewUrl: input.previewUrl,
    });
  };

  const addAttachmentsFromDrops = async (items: DroppedAttachment[]) => {
    if (!items.length) return;
    let slots = roomLeft();
    if (slots <= 0) {
      toastCap();
      return;
    }
    const existing = new Set(attachmentsRef.current.map((a) => a.path));
    for (const item of items) {
      if (!item.path || existing.has(item.path)) continue;
      if (slots <= 0) {
        toastCap();
        break;
      }
      if (item.kind === 'folder') {
        addFolderPath(item.path, item.name);
        existing.add(item.path);
        slots = roomLeft();
        continue;
      }
      await uploadAndAdd({ localPath: item.path, name: item.name || basenameOf(item.path) });
      // path changes after upload — track new path via attachmentsRef
      slots = roomLeft();
    }
  };

  const onPickAttach = async (kind: AttachKind) => {
    // WebUI / HTTP attach: folder picks have no gateway-local path — tip and bail
    // before the cancel stub so the fan does not look like a no-op.
    if (
      kind === 'folder' &&
      typeof document !== 'undefined' &&
      document.documentElement.dataset.okbotGateway === '1'
    ) {
      toast.info(t(lang, 'attachFolderUnavailable'));
      return;
    }
    try {
      const result = await window.okbot.pickPaths(kind);
      if (result.canceled) return;

      // Browser file input (httpOkbot.pickPaths) — upload bytes like paste/drop.
      const pickedFiles = result.files;
      if (pickedFiles?.length) {
        if (uploadingRef.current) return;
        uploadingRef.current = true;
        try {
          let slots = roomLeft();
          if (slots <= 0) {
            toastCap();
            return;
          }
          for (const file of pickedFiles) {
            if (!file || file.size <= 0) continue;
            if (slots <= 0) {
              toastCap();
              break;
            }
            const previewUrl = file.type.startsWith('image/')
              ? URL.createObjectURL(file)
              : undefined;
            await uploadAndAdd({
              file,
              name: file.name || undefined,
              previewUrl,
            });
            slots = roomLeft();
          }
        } finally {
          uploadingRef.current = false;
        }
        return;
      }

      if (!result.paths?.length) return;
      if (kind === 'folder') {
        for (const filePath of result.paths) {
          if (!filePath) continue;
          if (roomLeft() <= 0) {
            toastCap();
            break;
          }
          addFolderPath(filePath);
        }
        return;
      }
      await addAttachmentsFromDrops(
        result.paths
          .filter((filePath): filePath is string => Boolean(filePath))
          .map((filePath) => ({
            kind,
            path: filePath,
            name: basenameOf(filePath),
          })),
      );
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  };

  const onRemoveAttachment = (id: string) => {
    const prev = attachmentsRef.current;
    const target = prev.find((a) => a.id === id);
    if (target) revokePreview(target);
    updateAttachments(prev.filter((a) => a.id !== id));
  };

  const clearAttachments = useCallback(() => {
    for (const a of attachmentsRef.current) revokePreview(a);
    updateAttachments([]);
  }, []);

  const onPasteFiles = async (clipboardData: DataTransfer | null | undefined) => {
    if (listening) return false;
    const pasted = collectPastedFiles(clipboardData);
    if (!pasted.length) return false;
    if (uploadingRef.current) return true;
    uploadingRef.current = true;
    try {
      let slots = roomLeft();
      if (slots <= 0) {
        toastCap();
        return true;
      }
      for (const item of pasted) {
        if (slots <= 0) {
          toastCap();
          break;
        }
        const previewUrl =
          item.kind === 'image' ? URL.createObjectURL(item.file) : undefined;
        await uploadAndAdd({
          file: item.file,
          name: item.name,
          previewUrl,
        });
        slots = roomLeft();
      }
    } finally {
      uploadingRef.current = false;
    }
    return true;
  };

  const clearFileDragOver = () => {
    fileDragDepthRef.current = 0;
    setFileDragOver(false);
  };

  const onChatDragEnter = (e: React.DragEvent) => {
    if (listening || !dataTransferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    fileDragDepthRef.current += 1;
    setFileDragOver(true);
  };

  const onChatDragLeave = (e: React.DragEvent) => {
    if (!fileDragOver && fileDragDepthRef.current === 0) return;
    e.preventDefault();
    e.stopPropagation();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragOver(false);
  };

  const onChatDragOver = (e: React.DragEvent) => {
    if (listening || !dataTransferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onChatDrop = (e: React.DragEvent) => {
    const hadFiles = dataTransferHasFiles(e.dataTransfer);
    if (hadFiles) {
      e.preventDefault();
      e.stopPropagation();
    }
    clearFileDragOver();
    if (!hadFiles || listening) return;
    const dt = e.dataTransfer;
    const fileCount = dt.files?.length ?? 0;

    // Prefer path-based drops (desktop). Fall back to File blobs (paste-like / browser).
    const dropped = collectDroppedAttachments(dt, {
      getPathForFile:
        typeof window.okbot?.getPathForFile === 'function'
          ? (file) => window.okbot.getPathForFile(file)
          : undefined,
    });

    void (async () => {
      if (dropped.length) {
        await addAttachmentsFromDrops(dropped);
        return;
      }
      const files = Array.from(dt.files ?? []);
      if (!files.length) {
        if (fileCount > 0) toast.info(t(lang, 'attachDropNoPath'));
        return;
      }
      let slots = roomLeft();
      if (slots <= 0) {
        toastCap();
        return;
      }
      for (const file of files) {
        if (slots <= 0) {
          toastCap();
          break;
        }
        const previewUrl = file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined;
        await uploadAndAdd({ file, name: file.name || undefined, previewUrl });
        slots = roomLeft();
      }
    })();
  };

  return {
    attachments,
    attachmentsRef,
    updateAttachments,
    clearAttachments,
    onPickAttach,
    onRemoveAttachment,
    onPasteFiles,
    fileDragOver,
    onChatDragEnter,
    onChatDragLeave,
    onChatDragOver,
    onChatDrop,
    clearFileDragOver,
  };
}
