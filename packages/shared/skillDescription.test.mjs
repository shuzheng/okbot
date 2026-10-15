import assert from 'node:assert/strict';
import {
  SKILL_DESCRIPTION_MAX_CHARS,
  SKILL_DESCRIPTION_MIN_CHARS,
  normalizeSkillDescription,
  DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION,
  DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION,
} from './dist/index.js';

assert.equal(SKILL_DESCRIPTION_MAX_CHARS, 1024);
assert.equal(SKILL_DESCRIPTION_MIN_CHARS, 2);

assert.equal(normalizeSkillDescription('  hello  '), 'hello');
assert.equal(normalizeSkillDescription(null, 'okbot-fallback'), 'okbot-fallback');
assert.equal(normalizeSkillDescription('', 'okbot-fallback'), 'okbot-fallback');
assert.equal(normalizeSkillDescription('x', 'okbot-fallback'), 'okbot-fallback'); // too short
assert.equal(normalizeSkillDescription('导出时用'), '导出时用'); // short Chinese OK
assert.equal(normalizeSkillDescription('x'.repeat(1024)), 'x'.repeat(1024));
assert.equal(normalizeSkillDescription('x'.repeat(1025)), 'x'.repeat(1024));
assert.equal(normalizeSkillDescription('  从日志提取错误。何时使用：用户贴报错。勿用于：闲聊。  '), '从日志提取错误。何时使用：用户贴报错。勿用于：闲聊。');

// Prompt constants: gate + format rules present
assert.match(DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION, /okbot-/);
assert.match(DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION, /1024/);
assert.match(DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION, /description/);
assert.match(DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION, /1024/);
assert.match(DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION, /何时使用/);
assert.match(DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION, /Do NOT use for|勿用于/);
assert.match(DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION, /只写在 description/);
assert.match(DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION, /body 只写/);
assert.match(DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION, /避免「我能」「你可以」/);

console.log('skillDescription.test.mjs: ok');
