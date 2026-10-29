/**
 * Regression: ATX headings in「完整上下文」must have a blank line before
 * (when following non-empty content) and after (when followed by content).
 */
import { DEFAULT_TOOL_PREFERENCES } from '@okbot/shared';
import { normalizeMarkdownHeadings, formatSessionPromptContext } from './promptContext.ts';
import { buildAgentInstructions } from './index.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const bad = [
  '## instructions',
  '你是「001」，一个可使用授权工具在已连接电脑上工作的个人助手。',
  '## 助手资料（花名册，以这里为准）',
  '名称：001',
  '## 记忆（须遵守；过期项已过滤）',
  '### 全局记忆',
  '- [1] test',
].join('\n');

const fixed = normalizeMarkdownHeadings(bad);
assert(
  fixed.includes('## instructions\n\n你是「001」'),
  'expected blank line after ## instructions',
);
assert(
  fixed.includes('个人助手。\n\n## 助手资料'),
  'expected blank line before ## 助手资料',
);
assert(
  fixed.includes('名称：001\n\n## 记忆'),
  'expected blank line before ## 记忆',
);
assert(
  fixed.includes('已过滤）\n\n### 全局记忆\n\n- [1]'),
  'expected blank lines around ### 全局记忆',
);
assert(!/\n{3,}/.test(fixed), 'must not leave triple blank lines');

const prefs = {
  ...DEFAULT_TOOL_PREFERENCES,
  run_shell: { enabled: false, approval: 'ask' as const },
  read_file: { enabled: false, approval: 'ask' as const },
  read_skill: { enabled: false, approval: 'ask' as const },
  write_file: { enabled: false, approval: 'ask' as const },
  edit_file: { enabled: false, approval: 'ask' as const },
  generate_image: { enabled: false, approval: 'ask' as const },
  search_history: { enabled: false, approval: 'ask' as const },
  manage_schedule: { enabled: false, approval: 'ask' as const },
  manage_memory: { enabled: false, approval: 'ask' as const },
  web_fetch: { enabled: false, approval: 'ask' as const },
  web_search: { enabled: false, approval: 'ask' as const },
};

const instr = buildAgentInstructions(
  '001',
  '',
  [],
  prefs,
  undefined,
  undefined,
  '### 全局记忆\n\n- [1] test',
);
assert(
  instr.includes('个人助手。\n\n## 助手资料'),
  'buildAgentInstructions: blank before profile heading',
);
assert(
  instr.includes('## 记忆（须遵守；过期项已过滤）\n\n### 全局记忆\n\n- [1] test'),
  'buildAgentInstructions: blank around memory headings',
);
assert(
  instr.indexOf('## 助手资料') < instr.indexOf('## 记忆'),
  'buildAgentInstructions: stable profile before volatile memory',
);
assert(
  instr.indexOf('不要编造') < instr.indexOf('## 记忆'),
  'buildAgentInstructions: tools/style before memory (prefix-cache friendly)',
);
assert(
  instr.includes('不要问') && instr.includes('自动推进'),
  'buildAgentInstructions: task progress must auto-proceed without asking to continue',
);
assert(
  !instr.includes('强制（未完成任务）'),
  'buildAgentInstructions: unfinished sync only when queue has pending/in_progress',
);

const unfinished = buildAgentInstructions(
  '001',
  '',
  [],
  prefs,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  ['## 当前任务（持久；请先对照再行动；按添加顺序串行推进）', '', '### 任务 (task_1) 调研 [进行中]', '', '- [已完成] (1) A', '- [待做] (2) B'].join('\n'),
);
assert(
  unfinished.includes('强制（未完成任务）') && unfinished.includes('禁止只调研'),
  'buildAgentInstructions: unfinished queue must force update sync on continue',
);
assert(
  unfinished.includes('中途插问') &&
    unfinished.includes('同一轮继续推进') &&
    unfinished.includes('要继续推进吗') &&
    unfinished.includes('本轮不得因插问而结束'),
  'buildAgentInstructions: unfinished sync must forbid stop-and-ask after mid-run interrupt',
);
assert(
  instr.includes('一两句自然语言回应打断') &&
    instr.includes('同一轮立刻继续未完成计划') &&
    instr.includes('禁止只文字确认') &&
    instr.includes('0 次工具调用') &&
    instr.includes('要继续推进吗') &&
    instr.includes('不得停下来等用户确认') &&
    instr.includes('不要把每条新消息拆成'),
  'buildAgentInstructions: mid-run user input must ack then continue same turn without asking',
);
assert(
  unfinished.includes('一两句自然语言回应打断') && unfinished.includes('同一轮立刻继续未完成计划'),
  'buildAgentInstructions: soft-steer unfinished plan still gets mid-run continue rules',
);

const full = formatSessionPromptContext({
  instructions: instr,
  items: [],
  messageId: 'm1',
  found: true,
});
assert(
  full.includes('## instructions\n\n你是「001」'),
  'formatSessionPromptContext: blank after ## instructions',
);
assert(
  full.includes('个人助手。\n\n## 助手资料'),
  'formatSessionPromptContext: blank before profile heading',
);

console.log('promptContext.normalize.test.ts: ok');
