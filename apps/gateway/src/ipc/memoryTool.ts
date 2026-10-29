import type { MemoryEntry } from '@okbot/shared';
import type { FileStorage } from '../storage/FileStorage';

export type MemoryManageAction = 'list' | 'pin' | 'unpin' | 'promote' | 'forget';

export type MemoryManageInput = {
  action: MemoryManageAction;
  /** Memory id (required for pin/unpin/promote/forget). */
  memory_id?: string | null;
  /** global | bot (default bot). */
  scope?: 'global' | 'bot' | null;
  /** list: include candidates (default false = durable + pinned only). */
  include_candidates?: boolean | null;
};

function formatRow(e: MemoryEntry): string {
  const tier = e.tier === 'candidate' ? 'candidate' : 'durable';
  const hits = typeof e.hits === 'number' ? e.hits : 0;
  const pin = e.pinned ? ' 📌' : '';
  const exp = e.expires ? ` expires=${e.expires}` : '';
  return `- [${e.id}] (${tier}, hits=${hits})${pin}${exp} ${e.memory}`;
}

/** Bound `manage_memory` execute helper for one bot (1:1). Squads: bot-local N/A — still allow global. */
export function memoryManageForBot(storage: FileStorage, botId: string) {
  return async (input: MemoryManageInput): Promise<string> => {
    const action = input.action;
    const scope: 'global' | 'bot' = input.scope === 'global' ? 'global' : 'bot';
    const memoryId = (input.memory_id || '').trim();

    if (action === 'list') {
      const rows =
        scope === 'global' ? storage.listGlobalMemories() : storage.listBotMemories(botId);
      const includeCand = input.include_candidates === true;
      const filtered = includeCand
        ? rows
        : rows.filter((e) => e.pinned === true || e.tier !== 'candidate');
      if (!filtered.length) {
        return includeCand ? '当前没有记忆。' : '当前没有耐久/置顶记忆（可用 include_candidates 查看候选）。';
      }
      const label = scope === 'global' ? '全局' : '本助手';
      return [`${label}记忆（${filtered.length}）：`, ...filtered.map(formatRow)].join('\n');
    }

    if (!memoryId) return '错误：需要 memory_id。';

    if (action === 'pin' || action === 'unpin') {
      const row = storage.setMemoryPinned(scope, botId, memoryId, action === 'pin');
      if (!row) return `错误：未找到记忆 ${memoryId}（scope=${scope}）。`;
      return `已${action === 'pin' ? '置顶' : '取消置顶'}：\n${formatRow(row)}`;
    }

    if (action === 'promote') {
      const row = storage.promoteMemory(scope, botId, memoryId);
      if (!row) return `错误：未找到记忆 ${memoryId}（scope=${scope}）。`;
      return `已提升为耐久：\n${formatRow(row)}`;
    }

    if (action === 'forget') {
      const rows =
        scope === 'global' ? storage.listGlobalMemories() : storage.listBotMemories(botId);
      const prev = rows.find((e) => e.id === memoryId);
      if (!prev) return `错误：未找到记忆 ${memoryId}（scope=${scope}）。`;
      storage.deleteMemory(scope, botId, memoryId);
      return `已遗忘（删除）：${memoryId} — ${prev.memory.slice(0, 80)}`;
    }

    return `错误：未知 action ${action}`;
  };
}
