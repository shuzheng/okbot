/**
 * write_file / edit_file under owner resources/ must call imageAssets.onSaved
 * so the host can append resources.jsonl (same path as generate_image).
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-wf-index-'));
  const resourcesDir = path.join(tmp, 'resources');
  fs.mkdirSync(resourcesDir);
  const indexed: Array<{ filePath: string; assetRel: string; title?: string }> = [];
  const tools = buildTools(
    {
      ...DEFAULT_TOOL_PREFERENCES,
      write_file: { enabled: true, approval: 'allow' },
      edit_file: { enabled: true, approval: 'allow' },
    },
    DEFAULT_SECURITY,
    undefined,
    {
      imageAssets: {
        ownerId: 'bot_test',
        resourcesDir,
        onSaved: (info) => indexed.push(info),
      },
    },
  );
  const write = tools.find((t) => t.name === 'write_file');
  const edit = tools.find((t) => t.name === 'edit_file');
  assert.ok(write);
  assert.ok(edit);

  const out = await invokeTool(write!, { path: 'resources/日报模板.md', content: '# 工作日报\n' });
  assert.match(String(out), /已写入/);
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0]!.title, '日报模板.md');
  assert.equal(indexed[0]!.assetRel, 'bot_test/resources/日报模板.md');
  assert.ok(fs.existsSync(path.join(resourcesDir, '日报模板.md')));

  indexed.length = 0;
  await invokeTool(edit!, {
    path: 'resources/日报模板.md',
    old_text: '# 工作日报',
    new_text: '# 工作日报（修订）',
  });
  assert.equal(indexed.length, 1, 'edit under resources/ should re-index');

  indexed.length = 0;
  await invokeTool(write!, { path: 'scratch.txt', content: 'tmp\n' });
  assert.equal(indexed.length, 0, 'work-root relative path must not index');
  assert.ok(fs.existsSync(path.join(tmp, 'scratch.txt')));

  indexed.length = 0;
  const outside = path.join(tmp, 'outside.md');
  await invokeTool(write!, { path: outside, content: 'nope\n' });
  assert.equal(indexed.length, 0, 'absolute path outside resources/ must not index');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('writeFile.libraryIndex.test.ts: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
