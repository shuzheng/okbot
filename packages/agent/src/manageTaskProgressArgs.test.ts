import assert from 'node:assert/strict';
import { tool } from '@openai/agents';
import { z } from 'zod';

/** Mirror of manage_task_progress id coerce in tools.ts (keep in sync). */
const optionalToolId = z.preprocess((v) => {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return v;
}, z.string().nullable().optional());

const manageTaskProgressArgs = z.object({
  action: z.enum(['add', 'update', 'list']),
  id: optionalToolId,
  title: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'done', 'cancelled', 'failed']).nullable().optional(),
  steps: z
    .array(
      z.object({
        id: optionalToolId,
        title: z.string(),
        status: z.enum(['pending', 'in_progress', 'done', 'cancelled', 'failed']).nullable().optional(),
        note: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  step_id: optionalToolId,
  step_title: z.string().nullable().optional(),
  step_status: z.enum(['pending', 'in_progress', 'done', 'cancelled', 'failed']).nullable().optional(),
  step_note: z.string().nullable().optional(),
  step_new_title: z.string().nullable().optional(),
  include_done: z.boolean().nullable().optional(),
});

const raw = {
  action: 'add' as const,
  title: '百度调研',
  steps: [
    { id: 1, title: '百度公司基本情况', status: 'in_progress' as const, note: '' },
    { id: 2, title: '百度核心业务版图', status: 'pending' as const, note: '' },
  ],
};

const parsed = manageTaskProgressArgs.parse(raw);
assert.equal(parsed.steps?.[0]?.id, '1');
assert.equal(parsed.steps?.[1]?.id, '2');

const upd = manageTaskProgressArgs.parse({
  action: 'update',
  id: 'task_abc',
  step_id: 3,
  step_status: 'done',
});
assert.equal(upd.id, 'task_abc');
assert.equal(upd.step_id, '3');

const listed = manageTaskProgressArgs.parse({ action: 'list', include_done: true });
assert.equal(listed.include_done, true);

const omitted = manageTaskProgressArgs.parse({
  action: 'add',
  steps: [{ title: 'only title' }],
});
assert.equal(omitted.steps?.[0]?.id, undefined);

// OpenAI strict: bare `.optional()` without `.nullable()` throws UserError at tool().
tool({
  name: 'manage_task_progress',
  description: 'regression',
  parameters: manageTaskProgressArgs,
  execute: async () => 'ok',
});

console.log('manageTaskProgressArgs.test.ts: ok');
