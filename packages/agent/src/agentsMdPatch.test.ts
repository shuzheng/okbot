import assert from 'node:assert/strict';
import { mergeAgentsMdFromModel, parseMarkdownSections } from './agentsMdPatch.js';

const current = `# 角色与目标

保持原样。

# 用户偏好

- 旧偏好

# 项目与环境

- 仓库路径
`;

{
  const next = mergeAgentsMdFromModel(
    current,
    JSON.stringify({
      action: 'patch',
      sections: [{ heading: '用户偏好', body: '- 旧偏好\n- 新偏好' }],
    }),
  );
  assert.ok(next);
  assert.ok(next!.includes('保持原样。'));
  assert.ok(next!.includes('仓库路径'));
  assert.ok(next!.includes('新偏好'));
  assert.ok(next!.includes('# 角色与目标'));
}

{
  const rewritten = `# 角色与目标

改掉了。

# 用户偏好

- 全改

# 项目与环境

- 也改
`;
  assert.equal(mergeAgentsMdFromModel(current, rewritten), null);
}

{
  const next = mergeAgentsMdFromModel(
    current,
    JSON.stringify({
      action: 'patch',
      sections: [{ heading: '决定', body: '- 继续用 pnpm' }],
    }),
  );
  assert.ok(next);
  assert.ok(next!.includes('# 决定'));
  assert.ok(next!.includes('继续用 pnpm'));
  assert.ok(next!.includes('保持原样。'));
  assert.ok(next!.includes('- 旧偏好'));
}

{
  assert.equal(mergeAgentsMdFromModel(current, 'NO_CHANGE'), null);
  assert.equal(
    mergeAgentsMdFromModel(current, JSON.stringify({ action: 'none' })),
    null,
  );
}

{
  const parsed = parseMarkdownSections('# 用户偏好\n\n```\n# 假标题\n```\n\n- 真正文\n');
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0]!.heading, '用户偏好');
  assert.ok(parsed.sections[0]!.body.includes('# 假标题'));
}

{
  const one = '# 角色与目标\n\n保持原样。\n';
  const next = mergeAgentsMdFromModel(
    one,
    JSON.stringify({ action: 'patch', sections: [{ heading: '角色与目标', body: '更新了' }] }),
  );
  assert.ok(next);
  assert.ok(next!.includes('更新了'));
}

{
  const next = mergeAgentsMdFromModel(
    current,
    JSON.stringify({
      action: 'patch',
      sections: [
        { heading: '决定', body: '第一条' },
        { heading: '决定', body: '第二条' },
      ],
    }),
  );
  assert.ok(next);
  assert.equal((next!.match(/^# 决定$/gm) || []).length, 1);
  assert.ok(next!.includes('第二条'));
  assert.ok(!next!.includes('第一条'));
}

{
  const next = mergeAgentsMdFromModel(
    current,
    '好的，补丁如下：\n' +
      JSON.stringify({ action: 'patch', sections: [{ heading: '用户偏好', body: '- 来自前言' }] }),
  );
  assert.ok(next);
  assert.ok(next!.includes('来自前言'));
  assert.ok(next!.includes('保持原样。'));
}

console.log('agentsMdPatch.test.ts: ok');
