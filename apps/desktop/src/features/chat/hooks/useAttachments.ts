import { useRef, useState } from 'react';
import type { ComposerAttachment } from '../ChatComposer';
import type { AttachKind } from '../ComposerAttachMenu';
import {
  collectDroppedAttachments,
  dataTransferHasFiles,
  type DroppedAttachment,
} from '../../../utils/dropAttachments';
import { formatSystemError } from '../../../utils/formatSystemError';
import { toast } from '../../../components/ui';
import { t, type UiLang } from '../../../i18n';

function basenameOf(filePath: string) {
  const norm = filePath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) || norm : norm;
}

/**
 * Composer attachments + chat-area file drag/drop.
 * Behavior-preserving extract from App.tsx.
 */
export function useAttachments(opts: { lang: UiLang; listening: boolean }) {
  const { lang, listening } = opts;
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const fileDragDepthRef = useRef(0);
  const [fileDragOver, setFileDragOver] = useState(false);

  const updateAttachments = (next: ComposerAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const addAttachmentsFromDrops = (items: DroppedAttachment[]) => {
    if (!items.length) return;
    const prev = attachmentsRef.current;
    const existing = new Set(prev.map((a) => a.path));
    const added: ComposerAttachment[] = [];
    for (const item of items) {
      if (!item.path || existing.has(item.path)) continue;
      existing.add(item.path);
      added.push({
        id: `att_${Date.now()}_${added.length}_${Math.random().toString(36).slice(2, 8)}`,
        kind: item.kind,
        path: item.path,
        name: item.name || basenameOf(item.path),
      });
    }
    if (added.length) updateAttachments([...prev, ...added]);
  };

  const onPickAttach = async (kind: AttachKind) => {
    try {
      const result = await window.okbot.pickPaths(kind);
      if (result.canceled || !result.paths?.length) return;
      addAttachmentsFromDrops(
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
    updateAttachments(attachmentsRef.current.filter((a) => a.id !== id));
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
    const dropped = collectDroppedAttachments(dt, {
      getPathForFile:
        typeof window.okbot?.getPathForFile === 'function'
          ? (file) => window.okbot.getPathForFile(file)
          : undefined,
    });
    if (dropped.length) {
      addAttachmentsFromDrops(dropped);
      return;
    }
    if (fileCount > 0) {
      toast.info(t(lang, 'attachDropNoPath'));
    }
  };

  return {
    attachments,
    attachmentsRef,
    updateAttachments,
    onPickAttach,
    onRemoveAttachment,
    fileDragOver,
    onChatDragEnter,
    onChatDragLeave,
    onChatDragOver,
    onChatDrop,
    clearFileDragOver,
  };
}
