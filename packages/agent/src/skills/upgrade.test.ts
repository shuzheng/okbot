import assert from 'node:assert/strict';
import { upgradeSkillFormat } from './upgrade.js';
import { parseSkillMarkdown, formatSkillMarkdown } from './parse.js';

// Trigger-only ZH → capability + 何时使用 in description; body reshaped to template
{
  const r = upgradeSkillFormat({
    slug: 'okbot-explain-code',
    name: 'okbot-explain-code',
    description: '用户说看不懂某段代码、某条报错，或要你逐步讲解时使用。',
    body: '1. 用一句话说这段代码或报错在做什么。\n2. 按执行顺序说明。',
  });
  assert.equal(r.changed, true);
  assert.equal(r.reshapedBody, true);
  assert.match(r.skill.description, /何时使用/);
  assert.match(r.skill.body, /## 何时使用此技能/);
  assert.match(r.skill.body, /## 工作原理/);
  assert.match(r.skill.body, /用一句话说这段代码/);
  assert.match(r.skill.body, /## 示例/);
  assert.match(r.skill.body, /## 注意事项/);
  assert.ok(r.skill.description.length <= 1024);
}

// Trigger-only EN → Use when; English template headings
{
  const r = upgradeSkillFormat({
    slug: 'okbot-fix-bug',
    name: 'okbot-fix-bug',
    description: 'Use when the user pastes an error.',
    body: '1. Restate the symptom.\n2. Give a fix.',
  });
  assert.equal(r.changed, true);
  assert.equal(r.reshapedBody, true);
  assert.match(r.skill.description, /Use when/i);
  assert.match(r.skill.body, /## When to use this skill/i);
  assert.match(r.skill.body, /## How it works/i);
  assert.match(r.skill.body, /Restate the symptom/);
}

// Keep ## 何时使用 in body (do NOT move into description-only)
{
  const r = upgradeSkillFormat({
    slug: 'okbot-demo',
    name: 'okbot-demo',
    description: '整理部署配置。',
    body: [
      '# okbot-demo',
      '',
      '## 何时使用',
      '当 RCA 指向环境变量需要变更时。',
      '',
      '## 步骤',
      '1. 改 yaml。',
      '2. 回报变更。',
    ].join('\n'),
  });
  assert.equal(r.reshapedBody, true);
  assert.match(r.skill.body, /## 何时使用此技能/);
  assert.match(r.skill.body, /RCA/);
  assert.match(r.skill.body, /改 yaml/);
  assert.match(r.skill.body, /## 工作原理/);
}

// Already professional template — no reshape
{
  const body = [
    '# Okbot-good 技能',
    '',
    '## 何时使用此技能',
    '当用户贴报错时使用。',
    '',
    '## 工作原理',
    '1. 拉日志。',
    '2. 写结论。',
    '',
    '## 示例',
    '用户：「这段报错怎么修？」',
    '',
    '## 注意事项',
    '不要覆盖未确认的配置。',
  ].join('\n');
  const desc = '从日志提取错误。何时使用：用户贴报错。';
  const r = upgradeSkillFormat({
    slug: 'okbot-good',
    name: 'okbot-good',
    description: desc,
    body,
  });
  assert.equal(r.reshapedBody, false);
  assert.equal(r.skill.description, desc);
  assert.equal(r.skill.body, body);
  assert.equal(r.changed, false);
}

// Round-trip via format/parse keeps when section in body
{
  const md = formatSkillMarkdown({
    slug: 'okbot-x',
    name: 'okbot-x',
    description: '整理本机下载文件夹。',
    body: [
      '# Okbot-x 技能',
      '',
      '## 何时使用此技能',
      '当用户要整理下载文件夹时使用。',
      '',
      '## 工作原理',
      '1. 列出文件。',
      '',
      '## 示例',
      '用户：「帮我整理下载」。',
      '',
      '## 注意事项',
      '不要删除文件。',
    ].join('\n'),
  });
  const parsed = parseSkillMarkdown('okbot-x', md);
  const r = upgradeSkillFormat(parsed);
  assert.equal(r.reshapedBody, false);
  assert.match(r.skill.body, /## 何时使用此技能/);
  const again = upgradeSkillFormat(r.skill);
  assert.equal(again.changed, false);
}

// Plain steps only → full template
{
  const r = upgradeSkillFormat({
    slug: 'okbot-when-only',
    name: 'okbot-when-only',
    description: 'Runs a pack.',
    body: '1. Unpack.\n2. Report.',
  });
  assert.equal(r.reshapedBody, true);
  assert.match(r.skill.body, /## When to use this skill/i);
  assert.match(r.skill.body, /Unpack/);
  assert.match(r.skill.body, /## Examples/i);
  assert.match(r.skill.body, /## Notes/i);
}


// Fence-aware: bash block with # / ## headings must stay intact (no section split inside fence)
{
  const body = [
    '# Okbot-fence-demo 技能',
    '',
    '## 何时使用此技能',
    '当用户要跑示例脚本时使用。',
    '',
    '## 工作原理',
    '1. 展示脚本。',
    '2. 解释输出。',
    '',
    '## 示例',
    '```bash',
    '# 示例 1',
    'echo one',
    '',
    '## 注意事项',
    'export A=1',
    '```',
    '',
    '## 注意事项',
    '不要在未确认时执行脚本。',
  ].join('\n');
  const r = upgradeSkillFormat({
    slug: 'okbot-fence-demo',
    name: 'okbot-fence-demo',
    description: '展示带围栏示例的技能。何时使用：用户要看脚本。',
    body,
  });
  // Professional template already present → no reshape; fence content untouched.
  assert.equal(r.reshapedBody, false, 'should not reshape professional body with fences');
  assert.equal(r.skill.body, body, 'body bytes must be unchanged');
  assert.match(r.skill.body, /```bash\n# 示例 1\necho one\n\n## 注意事项\nexport A=1\n```/);
  // Legacy reshape path: body without when/how must keep fence headings inside the code block
  const legacy = upgradeSkillFormat({
    slug: 'okbot-fence-legacy',
    name: 'okbot-fence-legacy',
    description: 'Runs a demo. Use when user asks for a script sample.',
    body: [
      '1. Show the script.',
      '',
      '```bash',
      '# 示例 1',
      'echo one',
      '',
      '## 注意事项',
      'export A=1',
      '```',
    ].join('\n'),
  });
  assert.equal(legacy.reshapedBody, true);
  // Fence content must stay contiguous (lang may be zh from CJK inside the fence).
  assert.match(
    legacy.skill.body,
    /```bash\n# 示例 1\necho one\n\n## 注意事项\nexport A=1\n```/,
    'fenced block must stay intact after reshape',
  );
  // export A=1 must only appear inside the fence, not as a pulled-out Notes body.
  const withoutFence = legacy.skill.body.replace(/```[\s\S]*?```/g, '');
  assert.ok(
    !/export A=1/.test(withoutFence),
    'export A=1 must not be lifted out of the fence into Notes',
  );
  assert.ok(
    !/echo one\n[\s\S]*```bash/.test(legacy.skill.body),
    'echo one must not move above the fence',
  );
}

console.log('upgrade.test.ts: ok');
