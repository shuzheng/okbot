import {
  resourceDisplayTitle,
  type NoteCardMeta,
  type OwnerResourceRecord,
} from '@okbot/shared';
import type { FileStorage } from '../storage';
import { rejectDuplicateNoteCreate } from './sameTopicArtifactGate';

export type NoteManageAction = 'create' | 'update' | 'list' | 'get';

export type NoteManageInput = {
  action: NoteManageAction;
  /** create/update: note title (shown without .html). */
  title?: string | null;
  /** create/update: full self-contained HTML document. */
  html?: string | null;
  /** update/get: resource id. */
  id?: string | null;
  /** update: absolute path under owner resources/ (alternative to id). */
  path?: string | null;
};

function formatNote(rec: OwnerResourceRecord): string {
  const title = resourceDisplayTitle(rec.title, rec.type, rec.path);
  return `笔记 ${rec.id}「${title}」 path=${rec.path} updatedAt=${rec.updatedAt}`;
}

function toCard(rec: OwnerResourceRecord): NoteCardMeta {
  return {
    resourceId: rec.id,
    title: resourceDisplayTitle(rec.title, rec.type, rec.path),
  };
}

/** Bound `manage_note` execute helper for one owner (bot or squad). */
export function noteManageForOwner(
  storage: FileStorage,
  ownerId: string,
  onNoteCard?: (card: NoteCardMeta) => void,
) {
  return async (input: NoteManageInput): Promise<string> => {
    try {
      switch (input.action) {
        case 'list': {
          const notes = storage
            .listOwnerResources(ownerId)
            .filter((r) => r.type === 'note');
          if (!notes.length) return '当前没有笔记。';
          return notes.map((r) => formatNote(r)).join('\n');
        }
        case 'get': {
          const id = (input.id || '').trim();
          if (!id) return '错误：get 需要笔记 id。';
          const rec = storage.getOwnerResource(ownerId, id);
          if (!rec || rec.type !== 'note') return `错误：找不到笔记「${id}」。`;
          const html = storage.readOwnerResourceText(ownerId, id);
          return `${formatNote(rec)}\n\n--- html ---\n${html}`;
        }
        case 'create': {
          const html = (input.html || '').trim();
          if (!html) return '错误：create 需要 html（完整自包含 HTML 文档）。';
          const title = (input.title || '').trim() || '未命名笔记';
          const dup = rejectDuplicateNoteCreate(storage, ownerId, title);
          if (dup) return dup;
          const rec = storage.upsertOwnerResourceNote(ownerId, {
            title,
            html,
            createdBy: 'assistant',
          });
          onNoteCard?.(toCard(rec));
          return (
            `已创建笔记（${rec.id}）。\n${formatNote(rec)}\n` +
            '请在本轮对用户的回复中简要说明已记下；聊天气泡会附带笔记预览卡片（不要复述工具名或路径）。'
          );
        }
        case 'update': {
          const html = (input.html || '').trim();
          if (!html) return '错误：update 需要 html（完整自包含 HTML 文档）。';
          const id = (input.id || '').trim();
          const pathVal = (input.path || '').trim();
          if (!id && !pathVal) return '错误：update 需要 id 或 path。';
          const rec = storage.upsertOwnerResourceNote(ownerId, {
            id: id || undefined,
            path: pathVal || undefined,
            title: (input.title || '').trim() || undefined,
            html,
            createdBy: 'assistant',
          });
          onNoteCard?.(toCard(rec));
          return (
            `已更新笔记（${rec.id}）。\n${formatNote(rec)}\n` +
            '请在本轮对用户的回复中简要说明已维护；聊天气泡会附带笔记预览卡片（不要复述工具名或路径）。'
          );
        }
        default:
          return `错误：未知 action「${String((input as { action?: string }).action || '')}」。请用 create / update / list / get。`;
      }
    } catch (err) {
      return `错误：${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
