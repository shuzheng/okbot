/**
 * write_file same-topic gate: host assertLibraryWriteAllowed must reject creates
 * (overwrite of the same path still allowed). Used by bot, squad, and mesh paths.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_TOOL_PREFERENCES, DEFAULT_SECURITY } from '@okbot/shared';
import { buildTools } from './tools.js';

async function invokeTool(
  tool: { invoke: (...args: any[]) => Promise<unknown> },
  args: Record<string, unknown>,
): Promise<unknown> {
  const runContext = { context: {}, usage: {} };
  return tool.invoke(runContext, JSON.stringify(args));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-wf-gate-'));
  const resourcesDir = path.join(tmp, 'resources');
  fs.mkdirSync(resourcesDir);
  const existing = path.join(resourcesDir, '贪吃蛇游戏.html');
  fs.writeFileSync(existing, '<html>v1</html>', 'utf8');

  const gateCalls: string[] = [];
  const assertLibraryWriteAllowed = (input: { filePath: string }) => {
    gateCalls.push(input.filePath);
    const base = path.basename(input.filePath).replace(/\.[^.]+$/, '');
    const resolved = path.isAbsolute(input.filePath)
      ? input.filePath
      : path.join(tmp, input.filePath);
    // Same-path overwrite → allow (mirror rejectDuplicateLibraryWrite semantics)
    if (path.resolve(resolved) === path.resolve(existing)) return null;
    if (base === '贪吃蛇游戏') {
      return (
        '错误：资料库已有同题产物 id=res_html path=' +
        existing +
        ' type=html「贪吃蛇游戏」。请用 edit_file（或对同一路径 write_file 覆盖）维护已有文件，不要新建第二份。'
      );
    }
    return null;
  };

  const tools = buildTools(
    {
      ...DEFAULT_TOOL_PREFERENCES,
      write_file: { enabled: true, approval: 'allow' },
    },
    DEFAULT_SECURITY,
    undefined,
    {
      imageAssets: {
        ownerId: 'owner_squad_or_mesh',
        resourcesDir,
      },
      assertLibraryWriteAllowed,
    },
  );
  const write = tools.find((t) => t.name === 'write_file');
  assert.ok(write);

  // Same-topic new path under resources/ → reject
  const blocked = await invokeTool(write!, {
    path: 'resources/games/贪吃蛇游戏.html',
    content: '<html>dup</html>',
  });
  assert.match(String(blocked), /同题产物/);
  assert.match(String(blocked), /edit_file/);
  assert.ok(!fs.existsSync(path.join(resourcesDir, 'games', '贪吃蛇游戏.html')));

  // Same-path overwrite via resources/… → allow
  const allowed = await invokeTool(write!, {
    path: 'resources/贪吃蛇游戏.html',
    content: '<html>v2</html>',
  });
  assert.match(String(allowed), /已写入/);
  assert.equal(fs.readFileSync(existing, 'utf8'), '<html>v2</html>');

  // Unrelated topic at work root → allow (not indexed as library path)
  const other = await invokeTool(write!, {
    path: 'other.txt',
    content: 'ok\n',
  });
  assert.match(String(other), /已写入/);
  assert.ok(fs.existsSync(path.join(tmp, 'other.txt')));

  assert.ok(gateCalls.length >= 3, 'gate must be consulted for each write_file');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('writeFile.sameTopicGate.test.ts: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
