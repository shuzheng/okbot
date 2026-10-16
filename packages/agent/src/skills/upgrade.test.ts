import assert from 'node:assert/strict';
import { upgradeSkillFormat } from './upgrade.js';
import { parseSkillMarkdown, formatSkillMarkdown } from './parse.js';

// Trigger-only ZH → capability + 何时使用
{
  const r = upgradeSkillFormat({
    slug: 'okbot-explain-code',
    name: 'okbot-explain-code',
    description: '用户说看不懂某段代码、某条报错，或要你逐步讲解时使用。',
    body: '1. 用一句话说这段代码或报错在做什么。\n2. 按执行顺序说明。',
  });
  assert.equal(r.changed, true);
  assert.match(r.skill.description, /何时使用/);
  assert.match(r.skill.description, /用一句话说这段代码/);
  assert.doesNotMatch(r.skill.description, /时使用。$/);
  assert.ok(r.skill.description.length <= 1024);
}

// Trigger-only EN → capability + Use when
{
  const r = upgradeSkillFormat({
    slug: 'okbot-fix-bug',
    name: 'okbot-fix-bug',
    description: 'Use when the user pastes an error.',
    body: '1. Restate the symptom.\n2. Give a fix.',
  });
  assert.equal(r.changed, true);
  assert.match(r.skill.description, /Use when/i);
  assert.match(r.skill.description, /Restate the symptom/);
}

// Move ## 何时使用 from body into description
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
  assert.equal(r.movedWhenFromBody, true);
  assert.match(r.skill.description, /何时使用/);
  assert.match(r.skill.description, /RCA/);
  assert.doesNotMatch(r.skill.body, /何时使用/);
  assert.match(r.skill.body, /改 yaml/);
}

// Move ## When from body
{
  const r = upgradeSkillFormat({
    slug: 'okbot-rca',
    name: 'okbot-rca',
    description: 'Run screenshot RCA.',
    body: '## When\n\nUser reports headless timeout.\n\n## Steps\n\n1. Pull logs.',
  });
  assert.equal(r.movedWhenFromBody, true);
  assert.match(r.skill.description, /Use when/i);
  assert.doesNotMatch(r.skill.body, /^## When/m);
  assert.match(r.skill.body, /Pull logs/);
}

// Already good — no change (aside from normalize)
{
  const desc =
    '从日志提取错误。何时使用：用户贴报错。勿用于：闲聊。';
  const r = upgradeSkillFormat({
    slug: 'okbot-good',
    name: 'okbot-good',
    description: desc,
    body: '1. 拉日志。\n2. 写结论。',
  });
  assert.equal(r.movedWhenFromBody, false);
  assert.equal(r.skill.description, desc);
  assert.equal(r.changed, false);
}

// Round-trip via format/parse
{
  const md = formatSkillMarkdown({
    slug: 'okbot-x',
    name: 'okbot-x',
    description: '用户要整理下载文件夹时使用。',
    body: '## 何时使用\n整理桌面时。\n\n1. 列出文件。',
  });
  const parsed = parseSkillMarkdown('okbot-x', md);
  const r = upgradeSkillFormat(parsed);
  assert.equal(r.changed, true);
  assert.match(r.skill.description, /何时使用/);
  assert.doesNotMatch(r.skill.body, /何时使用/);
  const again = upgradeSkillFormat(r.skill);
  assert.equal(again.changed, false);
}


// Body was only ## When — keep when-text in body (still enrich description)
{
  const r = upgradeSkillFormat({
    slug: 'okbot-when-only',
    name: 'okbot-when-only',
    description: 'Runs a pack.',
    body: '## When\nnew body',
  });
  assert.equal(r.movedWhenFromBody, true);
  assert.match(r.skill.body, /new body/);
  assert.doesNotMatch(r.skill.body, /^## When/m);
  assert.match(r.skill.description, /Use when|何时使用|new body/i);
}

console.log('upgrade.test.ts: ok');
