/**
 * Soft-steer / cold-restore host resume context: structured, system-side
 * injection (not a user-visible bubble) so the model continues unfinished
 * tasks and edits existing resources instead of recreating them.
 */
import path from 'node:path';
import { resourceDisplayTitle, type OwnerResourceInfo } from '@okbot/shared';
import type { FileStorage } from '../../storage';

export type InterruptedRunReason = 'soft_steer' | 'cold_restore' | 'checkpoint' | 'manual_stop';

const REASON_LABEL: Record<InterruptedRunReason, string> = {
  soft_steer: '软接管（abort 后重启本轮）',
  cold_restore: '冷恢复（进程重启后的 HITL/会话续跑）',
  checkpoint: '检查点恢复（崩溃后的 RunState 续跑）',
  manual_stop: '手动停止后继续（保留的 RunState 检查点）',
};

/** Cap library dump so resume injection stays small. Newest first (list order). */
export const RESUME_RESOURCES_LIMIT = 40;

/** Cap tool-call digest lines from a steered RunState checkpoint. */
export const RESUME_TOOL_DIGEST_LIMIT = 40;

export type ResumeContextStorage = Pick<
  FileStorage,
  'formatTaskProgressForPrompt' | 'listOwnerResources'
>;

export type InterruptedRunResumeOptions = {
  /** Soft-steer replacement: the new user interrupt text (already in session). */
  interruptUserText?: string;
  /**
   * When soft-steer kept+loaded a mid-run RunState checkpoint for this turn.
   * `toolDigest` should already be formatted (or empty).
   */
  runCheckpoint?: {
    runId?: string;
    createdAt?: string;
    toolDigest?: string;
    /** True when this turn resumes via resumeAgentChatFromCheckpoint. */
    resumedFromRunState?: boolean;
  } | null;
};

/** Compact resources inventory for resume injection (path / title / type). */
export function formatOwnerResourcesForResumePrompt(
  resources: OwnerResourceInfo[] | null | undefined,
  limit = RESUME_RESOURCES_LIMIT,
): string {
  if (!resources?.length) return '';
  const rows: string[] = [];
  for (const r of resources.slice(0, Math.max(0, limit))) {
    const title = resourceDisplayTitle(r.title || r.name, r.type, r.path);
    const relOrPath = (() => {
      const p = (r.path || '').trim();
      if (!p) return '(无路径)';
      if (r.assetRel?.trim()) return r.assetRel.trim();
      // Prefer basename under resources/ when absolute.
      const base = path.basename(p);
      return base || p;
    })();
    rows.push(`- path=${relOrPath} title=${title || '（无标题）'} type=${r.type} id=${r.id}`);
  }
  if (resources.length > limit) {
    rows.push(`- …另有 ${resources.length - limit} 条未列出；需要时用 manage_note list / 资料库核对`);
  }
  return ['### 已有资料（path / title / type；新→旧）', ...rows].join('\n');
}

/**
 * Best-effort digest of function_call names from a serialized RunState JSON.
 * Used so soft-steer replacement turns can avoid naive re-fire when the host
 * injects resume context (full RunState resume also uses the same checkpoint).
 */
export function formatRunCheckpointToolDigest(
  serializedRunState: string | null | undefined,
  limit = RESUME_TOOL_DIGEST_LIMIT,
): string {
  const raw = (serializedRunState || '').trim();
  if (!raw) return '';
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return '';
  }
  const rows: string[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const rec = node as Record<string, unknown>;
    const rawItem = rec.rawItem;
    const rawRec =
      rawItem && typeof rawItem === 'object'
        ? (rawItem as Record<string, unknown>)
        : null;
    const type = typeof rec.type === 'string' ? rec.type : '';
    const rawType = rawRec && typeof rawRec.type === 'string' ? rawRec.type : '';
    const name =
      typeof rec.name === 'string' && rec.name.trim()
        ? rec.name.trim()
        : rawRec && typeof rawRec.name === 'string' && rawRec.name.trim()
          ? rawRec.name.trim()
          : '';
    const isCall = type === 'function_call' || rawType === 'function_call';
    if (isCall && name) {
      const callIdRaw =
        (typeof rec.call_id === 'string' && rec.call_id) ||
        (typeof rec.callId === 'string' && rec.callId) ||
        (rawRec && typeof rawRec.call_id === 'string' && rawRec.call_id) ||
        '';
      const key = `${name}\\0${callIdRaw}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(callIdRaw ? `- ${name} call_id=${callIdRaw}` : `- ${name}`);
      }
    }
    for (const value of Object.values(rec)) {
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(root);
  if (!rows.length) return '';
  const capped = rows.slice(0, Math.max(0, limit));
  if (rows.length > limit) {
    capped.push(`- …另有 ${rows.length - limit} 次工具调用未列出`);
  }
  return ['### 中断前已发出的工具调用（来自 RunState 检查点；勿无脑重放）', ...capped].join(
    '\n',
  );
}

/**
 * Build the invisible host resume block. Always includes the interruption note;
 * attaches unfinished-task summary and resources inventory when present.
 */
export function buildInterruptedRunResumeContext(
  storage: ResumeContextStorage,
  ownerId: string,
  reason: InterruptedRunReason,
  options?: InterruptedRunResumeOptions,
): string {
  const id = (ownerId || '').trim();
  if (!id) return '';

  let taskBlock = '';
  try {
    taskBlock = (storage.formatTaskProgressForPrompt(id) || '').trim();
  } catch (err) {
    console.error('[okbot] resume context: load tasks failed', err);
  }

  let resourcesBlock = '';
  try {
    const list = storage.listOwnerResources(id);
    resourcesBlock = formatOwnerResourcesForResumePrompt(list).trim();
  } catch (err) {
    console.error('[okbot] resume context: list resources failed', err);
  }

  const parts = [
    '## 主机恢复上下文（系统侧；用户不可见）',
    `上一轮运行因「${REASON_LABEL[reason]}」中断。你必须在已有任务与资料上继续/就地编辑，禁止另起炉灶或新建同题产物。`,
    '',
    '规则：',
    '- 未完成任务：对照下方「当前任务」（或 manage_task_progress list），用 update 对齐状态后继续推进。',
    '- 已有文件/网页：用 edit_file，或对**同一路径** write_file 覆盖；禁止再写第二份同名/同题文件。',
    '- 已有笔记：用 manage_note update（传已有 id 或 path）；禁止 create 同题第二篇。',
    '- 用户本轮新消息是打断补充，不是要求从零重做。',
  ];

  const ckpt = options?.runCheckpoint;
  if (ckpt) {
    const meta: string[] = [];
    if (ckpt.runId) meta.push(`runId=${ckpt.runId}`);
    if (ckpt.createdAt) meta.push(`createdAt=${ckpt.createdAt}`);
    parts.push(
      '',
      '### RunState 检查点交接',
      ckpt.resumedFromRunState
        ? '- 主机已从中断前的 RunState 检查点续跑；已完成的工具结果仍在状态里，禁止把同一 call 再发一遍。'
        : '- 主机已读取中断前的 RunState 检查点摘要并注入下方清单；会话里也有对应工具结果时，禁止无脑重放。',
      '- 进行中的 HTTP/工具无法撤销；若下方已列出同名工具，先核对结果再决定是否重试。',
      ...(meta.length ? [`- 检查点元数据：${meta.join(' ')}`] : []),
    );
    const digest = (ckpt.toolDigest || '').trim();
    if (digest) {
      parts.push('', digest);
    }
  }

  const interrupt = (options?.interruptUserText || '').trim();
  if (interrupt) {
    const clipped = interrupt.length > 2000 ? `${interrupt.slice(0, 2000)}…` : interrupt;
    parts.push('', '### 用户本轮打断消息', clipped);
  }

  if (taskBlock) {
    parts.push('', taskBlock);
  } else {
    parts.push('', '### 未完成任务', '（当前无持久任务记录）');
  }

  if (resourcesBlock) {
    parts.push('', resourcesBlock);
  } else {
    parts.push('', '### 已有资料（path / title / type）', '（资料库暂无条目）');
  }

  return parts.join('\n').trim();
}
