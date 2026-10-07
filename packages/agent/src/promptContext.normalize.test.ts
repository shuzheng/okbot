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
  '你是「001」，一个可使用本机工具的桌面个人助手。',
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
  fixed.includes('桌面个人助手。\n\n## 助手资料'),
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
  instr.includes('桌面个人助手。\n\n## 助手资料'),
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
  full.includes('桌面个人助手。\n\n## 助手资料'),
  'formatSessionPromptContext: blank before profile heading',
);

console.log('promptContext.normalize.test.ts: ok');
