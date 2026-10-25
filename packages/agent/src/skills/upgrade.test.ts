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

console.log('upgrade.test.ts: ok');
