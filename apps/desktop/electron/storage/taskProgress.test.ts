import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isUlid } from '@okbot/shared';
import { FileStorage } from './FileStorage';
import {
  deriveTaskStatus,
  fingerprintTasks,
  formatTasksForPrompt,
  hasUnfinishedTasks,
  normalizeTaskRecord,
  normalizeTaskStep,
} from './TaskProgressStore';

// --- normalize step ---
assert.equal(normalizeTaskStep({ title: '' }, 0), null);
assert.deepEqual(normalizeTaskStep({ title: '  A  ', status: 'done' }, 0), {
  id: '1',
  title: 'A',
  status: 'done',
});
assert.equal(normalizeTaskStep({ title: 'x', status: 'nope' }, 2)?.status, 'pending');
assert.equal(normalizeTaskStep({ title: 'x', status: 'nope' }, 2)?.id, '3');
assert.deepEqual(
  normalizeTaskStep({ id: 1, title: '百度公司基本情况', status: 'in_progress', note: '' }, 0),
  { id: '1', title: '百度公司基本情况', status: 'in_progress' },
);
assert.equal(normalizeTaskStep({ id: 2, title: 'B' }, 9)?.id, '2');
assert.equal(normalizeTaskStep({ title: 'f', status: 'failed' }, 0)?.status, 'failed');

// --- derive status ---
assert.equal(deriveTaskStatus([{ id: '1', title: 'A', status: 'pending' }]), 'pending');
assert.equal(
  deriveTaskStatus([
    { id: '1', title: 'A', status: 'done' },
    { id: '2', title: 'B', status: 'in_progress' },
  ]),
  'in_progress',
);
assert.equal(
  deriveTaskStatus([
    { id: '1', title: 'A', status: 'done' },
    { id: '2', title: 'B', status: 'done' },
  ]),
  'done',
);
assert.equal(
  deriveTaskStatus(
    [
      { id: '1', title: 'A', status: 'pending' },
      { id: '2', title: 'B', status: 'pending' },
    ],
    'cancelled',
  ),
  'cancelled',
);

// --- normalize task ---
const emptyTask = normalizeTaskRecord(null);
assert.equal(emptyTask, null);

const dup = normalizeTaskRecord({
  v: 1,
  id: 't1',
  title: 'Plan',
  steps: [
    { id: 'a', title: 'One', status: 'pending' },
    { id: 'a', title: 'Two', status: 'in_progress', note: ' n ' },
  ],
});
assert.ok(dup);
assert.equal(dup!.steps.length, 2);
assert.equal(dup!.steps[0]!.id, 'a');
assert.equal(dup!.steps[1]!.id, 'a_2');
assert.equal(dup!.status, 'in_progress');
assert.ok(formatTasksForPrompt([dup!]).includes('进行中'));
assert.equal(formatTasksForPrompt([]), '');
assert.equal(hasUnfinishedTasks([]), false);
assert.equal(hasUnfinishedTasks([dup!]), true);
assert.equal(
  hasUnfinishedTasks([
    {
      v: 1,
      id: 'x',
      status: 'done',
      steps: [{ id: '1', title: 'A', status: 'done' }],
      updatedAt: 't',
    },
  ]),
  false,
);

const fp1 = fingerprintTasks([dup!]);
const fp2 = fingerprintTasks([{ ...dup!, updatedAt: 'other' }]);
assert.equal(fp1, fp2, 'fingerprint ignores updatedAt');

// legacy items key
const fromItems = normalizeTaskRecord({
  id: 'legacy',
  title: '旧',
  items: [{ title: '一步', status: 'pending' }],
});
assert.equal(fromItems?.steps.length, 1);

// --- FileStorage multi-task ---
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-tasks-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'A' });

const t1 = storage.addTask(bot.id, {
  title: '迁移',
  steps: [
    { title: '备份', status: 'done' },
    { id: 'step2', title: '切换', status: 'in_progress' },
  ],
});
assert.ok(isUlid(t1.id), `new task id must be ULID, got ${t1.id}`);
assert.ok(isUlid(t1.steps[0]!.id), `auto step id must be ULID, got ${t1.steps[0]!.id}`);
assert.equal(t1.steps[1]!.id, 'step2');
assert.equal(t1.status, 'in_progress');
assert.ok(t1.startedAt);
assert.ok(fs.existsSync(path.join(root, bot.id, 'tasks.jsonl')));

const t1u = storage.updateTask(bot.id, {
  id: t1.id,
  step_id: 'step2',
  step_status: 'done',
  step_note: 'ok',
});
assert.equal(t1u.status, 'done');
assert.ok(t1u.endedAt);
assert.equal(t1u.steps.find((s) => s.id === 'step2')?.note, 'ok');

// done tasks stay on disk (history) but not in open list
assert.equal(storage.loadOpenTasks(bot.id).length, 0);
assert.equal(storage.loadTasks(bot.id).length, 1);

const t2 = storage.addTask(bot.id, {
  title: '第二件',
  steps: [{ title: '调研', status: 'pending' }],
});
assert.ok(isUlid(t2.id), `second task id must be ULID, got ${t2.id}`);
assert.ok(t2.id > t1.id || t2.id !== t1.id, 'ULIDs should differ');
assert.equal(storage.loadOpenTasks(bot.id).length, 1);
assert.equal(storage.loadTasks(bot.id).length, 2);

// FIFO order preserved in jsonl
const all = storage.loadTasks(bot.id);
assert.equal(all[0]!.id, t1.id);
assert.equal(all[1]!.id, t2.id);

const prompt = storage.formatTaskProgressForPrompt(bot.id);
assert.ok(prompt.includes('当前任务'));
assert.ok(prompt.includes('已完成'));
assert.ok(prompt.includes('第二件'));

// non-ULID custom id is replaced with a minted ULID
const t3 = storage.addTask(bot.id, {
  id: 'not-a-ulid',
  title: '强制 ULID',
  steps: [{ title: '一步', status: 'pending' }],
});
assert.ok(isUlid(t3.id));
assert.notEqual(t3.id, 'not-a-ulid');

// valid ULID custom id is kept when unique
const custom = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const t4 = storage.addTask(bot.id, {
  id: custom,
  title: '自定义 ULID',
  steps: [{ id: 's1', title: '一步', status: 'pending' }],
});
assert.equal(t4.id, custom);

storage.clearTaskProgress(bot.id);
assert.equal(storage.loadTasks(bot.id).length, 0);
assert.ok(!fs.existsSync(path.join(root, bot.id, 'tasks.jsonl')));

fs.rmSync(root, { recursive: true, force: true });
console.log('taskProgress.test.ts: ok');
