import assert from 'node:assert/strict';
import {
  OWNER_DESCRIPTION_MAX_CHARS,
  clampOwnerDescription,
  sanitizeOwnerDescriptionDuties,
} from './dist/index.js';

assert.equal(OWNER_DESCRIPTION_MAX_CHARS, 200);
assert.equal(clampOwnerDescription('  hello  '), 'hello');
assert.equal(clampOwnerDescription(null), '');
assert.equal(clampOwnerDescription(undefined), '');
assert.equal(clampOwnerDescription('x'.repeat(200)), 'x'.repeat(200));
assert.equal(clampOwnerDescription('x'.repeat(201)), 'x'.repeat(200));
assert.equal(clampOwnerDescription('  中文简介  '), '中文简介');

// Strip generic capability / safety boilerplate; keep duties.
assert.equal(
  sanitizeOwnerDescriptionDuties(
    '用简单的话讲清概念、配生活例子和练习题帮你巩固，也能读写文件、查资料、执行命令、生成图片和定时任务，记住你的偏好让协作更顺手。',
  ),
  '用简单的话讲清概念、配生活例子和练习题帮你巩固，记住你的偏好让协作更顺手。',
);
assert.equal(
  sanitizeOwnerDescriptionDuties(
    '本机个人助手，主要帮用户做资料检索。回答简洁直接，动手前先说明假设，破坏性操作会先征得同意。',
  ),
  '本机个人助手，主要帮用户做资料检索。回答简洁直接，动手前先说明假设。',
);
assert.equal(
  sanitizeOwnerDescriptionDuties(
    '支持读写文件、执行命令、查资料、生成图片、管理定时任务等；同时负责 OkBot 环境与功能的测试。',
  ),
  '同时负责 OkBot 环境与功能的测试。',
);
assert.equal(
  sanitizeOwnerDescriptionDuties('把一件事拆成清单，排出先后和时间。'),
  '把一件事拆成清单，排出先后和时间。',
);
assert.equal(sanitizeOwnerDescriptionDuties('不写、不传密钥和验证码等敏感信息'), '');

console.log('ownerDescription.test.mjs: ok');
