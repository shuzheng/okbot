import fs from 'node:fs';
import path from 'node:path';
import {
  createUlid,
  isOpenTaskStatus,
  isTaskStatus,
  isTerminalTaskStatus,
  isUlid,
  type TaskRecord,
  type TaskStatus,
  type TaskStep,
} from '@okbot/shared';
import { assertWritable, ensureDir } from './fs';
import type { OwnerLifecycle } from './ownerLifecycle';

export type TaskProgressStoreDeps = {
  botDir(botId: string): string;
  ensureBotLayout(botId: string): void;
};

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['done', 'cancelled', 'failed']);

function nowIso(): string {
  return new Date().toISOString();
}

function coerceId(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'boolean') return String(raw);
  return fallback;
}

/** Normalize one step; returns null when unusable. */
export function normalizeTaskStep(raw: unknown, index: number): TaskStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) return null;
  const id = coerceId(o.id, String(index + 1));
  const status = isTaskStatus(o.status) ? o.status : 'pending';
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined;
  const startedAt =
    typeof o.startedAt === 'string' && o.startedAt.trim() ? o.startedAt.trim() : undefined;
  const endedAt =
    typeof o.endedAt === 'string' && o.endedAt.trim() ? o.endedAt.trim() : undefined;
  const updatedAt =
    typeof o.updatedAt === 'string' && o.updatedAt.trim() ? o.updatedAt.trim() : undefined;
  const step: TaskStep = { id, title, status };
  if (note) step.note = note;
  if (startedAt) step.startedAt = startedAt;
  if (endedAt) step.endedAt = endedAt;
  if (updatedAt) step.updatedAt = updatedAt;
  return step;
}

/** Derive task status from steps (explicit cancelled/failed wins). */
export function deriveTaskStatus(
  steps: TaskStep[],
  explicit?: TaskStatus | null,
): TaskStatus {
  if (explicit === 'cancelled' || explicit === 'failed') return explicit;
  if (!steps.length) return explicit && isTaskStatus(explicit) ? explicit : 'pending';
  if (steps.some((s) => s.status === 'in_progress')) return 'in_progress';
  if (steps.every((s) => s.status === 'done')) return 'done';
  if (steps.every((s) => s.status === 'cancelled')) return 'cancelled';
  if (
    steps.some((s) => s.status === 'failed') &&
    steps.every((s) => TERMINAL.has(s.status))
  ) {
    return 'failed';
  }
  if (steps.some((s) => s.status === 'done' || s.status === 'failed' || s.status === 'cancelled')) {
    // Mixed progress with remaining pending → treat as in progress.
    if (steps.some((s) => s.status === 'pending')) return 'in_progress';
  }
  if (explicit && isTaskStatus(explicit) && explicit === 'in_progress') return 'in_progress';
  return 'pending';
}

function applyStepTimestamps(prev: TaskStep | undefined, next: TaskStep, at: string): TaskStep {
  const out: TaskStep = { ...next, updatedAt: at };
  if (next.status === 'in_progress' && !prev?.startedAt && !next.startedAt) {
    out.startedAt = at;
  } else if (prev?.startedAt) {
    out.startedAt = prev.startedAt;
  } else if (next.startedAt) {
    out.startedAt = next.startedAt;
  }
  if (isTerminalTaskStatus(next.status)) {
    out.endedAt = next.endedAt || prev?.endedAt || at;
  } else if (prev?.endedAt && !isTerminalTaskStatus(next.status)) {
    // Re-opened: drop endedAt
    delete out.endedAt;
  } else if (next.endedAt) {
    out.endedAt = next.endedAt;
  }
  return out;
}

function applyTaskTimestamps(prev: TaskRecord | undefined, next: TaskRecord, at: string): TaskRecord {
  const out: TaskRecord = { ...next, updatedAt: at };
  if (next.status === 'in_progress' && !prev?.startedAt && !next.startedAt) {
    out.startedAt = at;
  } else if (prev?.startedAt) {
    out.startedAt = prev.startedAt;
  } else if (next.startedAt) {
    out.startedAt = next.startedAt;
  }
  if (isTerminalTaskStatus(next.status)) {
    out.endedAt = next.endedAt || prev?.endedAt || at;
  } else {
    if (prev?.endedAt && !isTerminalTaskStatus(next.status)) {
      delete out.endedAt;
    } else if (next.endedAt) {
      out.endedAt = next.endedAt;
    }
  }
  return out;
}

/** Normalize one task line (or null when unusable). */
export function normalizeTaskRecord(raw: unknown, index = 0): TaskRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = coerceId(o.id, `task_${index + 1}`);
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : undefined;
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined;
  // Accept legacy `items` or new `steps`
  const stepsIn = Array.isArray(o.steps) ? o.steps : Array.isArray(o.items) ? o.items : [];
  const steps: TaskStep[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < stepsIn.length; i++) {
    const step = normalizeTaskStep(stepsIn[i], i);
    if (!step) continue;
    let sid = step.id;
    if (seen.has(sid)) sid = `${sid}_${i + 1}`;
    seen.add(sid);
    steps.push(sid === step.id ? step : { ...step, id: sid });
  }
  const explicit = isTaskStatus(o.status) ? o.status : undefined;
  const status = deriveTaskStatus(steps, explicit);
  const updatedAt =
    typeof o.updatedAt === 'string' && o.updatedAt.trim() ? o.updatedAt.trim() : nowIso();
  const startedAt =
    typeof o.startedAt === 'string' && o.startedAt.trim() ? o.startedAt.trim() : undefined;
  const endedAt =
    typeof o.endedAt === 'string' && o.endedAt.trim() ? o.endedAt.trim() : undefined;
  const task: TaskRecord = { v: 1, id, status, steps, updatedAt };
  if (title) task.title = title;
  if (note) task.note = note;
  if (startedAt) task.startedAt = startedAt;
  if (endedAt) task.endedAt = endedAt;
  return task;
}

/** True when any non-terminal task (or its steps) is still pending / in_progress. */
export function hasUnfinishedTasks(tasks: TaskRecord[] | null | undefined): boolean {
  if (!tasks?.length) return false;
  return tasks.some((t) => {
    // Cancelled / failed / done tasks must not drive auto-continue even if steps remain.
    if (!isOpenTaskStatus(t.status)) return false;
    return (
      t.status === 'pending' ||
      t.status === 'in_progress' ||
      t.steps.some((s) => s.status === 'pending' || s.status === 'in_progress')
    );
  });
}

/**
 * Stable fingerprint of all tasks/steps for auto-continue stall escalation.
 * Ignores updatedAt / startedAt / endedAt.
 */
export function fingerprintTasks(tasks: TaskRecord[] | null | undefined): string {
  if (!tasks?.length) return '';
  return tasks
    .map((t) => {
      const title = (t.title || '').trim();
      const steps = t.steps
        .map((s) => `${s.id}\0${s.title}\0${s.status}\0${s.note || ''}`)
        .join('\n');
      return `${t.id}\0${title}\0${t.status}\0${t.note || ''}\n${steps}`;
    })
    .join('\n---\n');
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待做',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
  failed: '失败',
};

/** Compact Chinese summary for system-prompt injection (all tasks; history kept). */
export function formatTasksForPrompt(tasks: TaskRecord[] | null | undefined): string {
  if (!tasks?.length) return '';
  const blocks: string[] = ['## 当前任务（持久；请先对照再行动；按添加顺序串行推进）', ''];
  for (const t of tasks) {
    const head = t.title?.trim()
      ? `### 任务 (${t.id}) ${t.title.trim()} [${STATUS_LABEL[t.status]}]`
      : `### 任务 (${t.id}) [${STATUS_LABEL[t.status]}]`;
    blocks.push(head);
    if (t.note?.trim()) blocks.push(`备注：${t.note.trim()}`);
    if (!t.steps.length) {
      blocks.push('- （无步骤）');
    } else {
      for (const s of t.steps) {
        const note = s.note ? ` — ${s.note}` : '';
        blocks.push(`- [${STATUS_LABEL[s.status]}] (${s.id}) ${s.title}${note}`);
      }
    }
    blocks.push('');
  }
  return blocks.join('\n').trimEnd();
}


function writeJsonlAtomic(file: string, lines: string[]): void {
  assertWritable(file);
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  const body = lines.length ? `${lines.join('\n')}\n` : '';
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Per-owner durable multi-task queue at `~/.okbot/<owner>/tasks.jsonl`.
 * One JSON object per line = one task. APPEND new tasks; UPDATE rewrites that
 * line in place by task id. History (done/cancelled/failed) is kept.
 */
export class TaskProgressStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: TaskProgressStoreDeps,
  ) {}

  private jsonl(ownerId: string): string {
    return path.join(this.deps.botDir(ownerId), 'tasks.jsonl');
  }

  /** Load all tasks (including terminal history). */
  loadAll(ownerId: string): TaskRecord[] {
    const file = this.jsonl(ownerId);
    if (!fs.existsSync(file)) return [];
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const out: TaskRecord[] = [];
    const seen = new Set<string>();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const task = normalizeTaskRecord(parsed, i);
      if (!task) continue;
      let id = task.id;
      if (seen.has(id)) id = `${id}_${i + 1}`;
      seen.add(id);
      out.push(id === task.id ? task : { ...task, id });
    }
    return out;
  }

  /** Open tasks only (UI above composer). */
  loadOpen(ownerId: string): TaskRecord[] {
    return this.loadAll(ownerId).filter((t) => isOpenTaskStatus(t.status));
  }

  private persist(ownerId: string, tasks: TaskRecord[]): TaskRecord[] {
    this.deps.ensureBotLayout(ownerId);
    this.life.assertOwnerAlive(ownerId);
    ensureDir(path.dirname(this.jsonl(ownerId)));
    writeJsonlAtomic(
      this.jsonl(ownerId),
      tasks.map((t) => JSON.stringify(t)),
    );
    return tasks;
  }

  /** APPEND a new task (enqueue). */
  addTask(
    ownerId: string,
    input: {
      id?: string;
      title?: string;
      note?: string;
      status?: TaskStatus;
      steps?: Array<{
        id?: string;
        title: string;
        status?: TaskStatus;
        note?: string;
      }>;
    },
  ): TaskRecord {
    const at = nowIso();
    const all = this.loadAll(ownerId);
    const idRaw = (input.id || '').trim();
    // New task ids are always ULIDs (keep caller ULID if unique; else mint).
    let id = isUlid(idRaw) ? idRaw : createUlid();
    if (all.some((t) => t.id === id)) id = createUlid();
    const stepsIn = input.steps || [];
    const steps: TaskStep[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < stepsIn.length; i++) {
      const raw = stepsIn[i]!;
      const stepId =
        raw.id != null && String(raw.id).trim() ? String(raw.id).trim() : createUlid();
      const step = normalizeTaskStep(
        {
          id: stepId,
          title: raw.title,
          status: raw.status ?? 'pending',
          note: raw.note,
        },
        i,
      );
      if (!step) continue;
      let sid = step.id;
      if (seen.has(sid)) sid = `${sid}_${i + 1}`;
      seen.add(sid);
      steps.push(applyStepTimestamps(undefined, { ...step, id: sid }, at));
    }
    const status = deriveTaskStatus(steps, input.status);
    let task: TaskRecord = {
      v: 1,
      id,
      status,
      steps,
      updatedAt: at,
    };
    if (input.title?.trim()) task.title = input.title.trim();
    if (input.note?.trim()) task.note = input.note.trim();
    task = applyTaskTimestamps(undefined, task, at);
    this.persist(ownerId, [...all, task]);
    return task;
  }

  /**
   * UPDATE one task by id (rewrite that JSONL line in place).
   * Pass `steps` to replace the full step list; or `step_id` + step_* to patch one step.
   */
  updateTask(
    ownerId: string,
    input: {
      id: string;
      title?: string;
      note?: string;
      status?: TaskStatus;
      steps?: Array<{
        id?: string;
        title: string;
        status?: TaskStatus;
        note?: string;
      }>;
      step_id?: string;
      step_title?: string;
      step_status?: TaskStatus;
      step_note?: string;
      step_new_title?: string;
    },
  ): TaskRecord {
    const at = nowIso();
    const all = this.loadAll(ownerId);
    const id = (input.id || '').trim();
    if (!id) throw new Error('需要任务 id');
    const idx = all.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`找不到任务「${id}」`);
    const prev = all[idx]!;

    let steps = prev.steps;
    if (input.steps) {
      const nextSteps: TaskStep[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < input.steps.length; i++) {
        const raw = input.steps[i]!;
        const stepId =
          raw.id != null && String(raw.id).trim() ? String(raw.id).trim() : createUlid();
        const step = normalizeTaskStep(
          {
            id: stepId,
            title: raw.title,
            status: raw.status ?? 'pending',
            note: raw.note,
          },
          i,
        );
        if (!step) continue;
        let sid = step.id;
        if (seen.has(sid)) sid = `${sid}_${i + 1}`;
        seen.add(sid);
        const old = prev.steps.find((s) => s.id === sid);
        nextSteps.push(applyStepTimestamps(old, { ...step, id: sid }, at));
      }
      steps = nextSteps;
    } else if (input.step_id || input.step_title) {
      const sid = (input.step_id || '').trim();
      const stitle = (input.step_title || '').trim();
      let sidx = -1;
      if (sid) sidx = steps.findIndex((s) => s.id === sid);
      if (sidx < 0 && stitle) {
        const matches = steps
          .map((s, i) => (s.title === stitle ? i : -1))
          .filter((i) => i >= 0);
        if (matches.length === 1) sidx = matches[0]!;
        else if (matches.length > 1) throw new Error(`步骤标题「${stitle}」匹配到多条，请传 step_id`);
      }
      if (sidx < 0) throw new Error(sid || stitle ? '找不到对应的步骤' : '需要 step_id 或 step_title');
      const old = steps[sidx]!;
      const patched: TaskStep = {
        id: old.id,
        title: (input.step_new_title || '').trim() || old.title,
        status:
          input.step_status && isTaskStatus(input.step_status) ? input.step_status : old.status,
      };
      const note =
        input.step_note !== undefined
          ? input.step_note.trim() || undefined
          : old.note;
      if (note) patched.note = note;
      const next = steps.slice();
      next[sidx] = applyStepTimestamps(old, patched, at);
      steps = next;
    }

    const explicitStatus =
      input.status && isTaskStatus(input.status) ? input.status : undefined;
    // When only patching a step, re-derive; when explicit cancelled/failed, keep.
    const status = deriveTaskStatus(steps, explicitStatus ?? undefined);

    let task: TaskRecord = {
      v: 1,
      id: prev.id,
      status,
      steps,
      updatedAt: at,
    };
    const title =
      input.title !== undefined
        ? input.title.trim() || undefined
        : prev.title;
    const note =
      input.note !== undefined
        ? input.note.trim() || undefined
        : prev.note;
    if (title) task.title = title;
    if (note) task.note = note;
    if (prev.startedAt) task.startedAt = prev.startedAt;
    if (prev.endedAt) task.endedAt = prev.endedAt;
    task = applyTaskTimestamps(prev, task, at);

    const nextAll = all.slice();
    nextAll[idx] = task;
    this.persist(ownerId, nextAll);
    return task;
  }

  /** Replace whole file (tests / rare). */
  saveAll(ownerId: string, tasks: TaskRecord[]): TaskRecord[] {
    const at = nowIso();
    const normalized = tasks
      .map((t, i) => normalizeTaskRecord({ ...t, updatedAt: t.updatedAt || at }, i))
      .filter((t): t is TaskRecord => t != null);
    return this.persist(ownerId, normalized);
  }

  clear(ownerId: string): void {
    const file = this.jsonl(ownerId);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}
