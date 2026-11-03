/**
 * Soft-steer / cold-restore host resume context formatting.
 */
import assert from 'node:assert/strict';
import {
  buildInterruptedRunResumeContext,
  formatOwnerResourcesForResumePrompt,
  formatRunCheckpointToolDigest,
} from './softSteerResumeContext';
import type { OwnerResourceInfo } from '@okbot/shared';

{
  const empty = formatOwnerResourcesForResumePrompt([]);
  assert.equal(empty, '');
}

{
  const list: OwnerResourceInfo[] = [
    {
      id: 'r1',
      type: 'html',
      title: '贪吃蛇游戏',
      path: '/Users/x/.okbot/data/bot/resources/贪吃蛇游戏.html',
      createdBy: 'assistant',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      name: '贪吃蛇游戏',
      assetRel: 'bot/resources/贪吃蛇游戏.html',
    },
  ];
  const block = formatOwnerResourcesForResumePrompt(list);
  assert.match(block, /已有资料/);
  assert.match(block, /type=html/);
  assert.match(block, /贪吃蛇游戏/);
  assert.match(block, /id=r1/);
}

{
  const storage = {
    formatTaskProgressForPrompt() {
      return '## 当前任务（持久；请先对照再行动；按添加顺序串行推进）\n\n### 任务 (t1) 做蛇 [进行中]\n- [进行中] (1) 写页面';
    },
    listOwnerResources() {
      return [
        {
          id: 'r1',
          type: 'html' as const,
          title: '贪吃蛇游戏',
          path: '/tmp/resources/贪吃蛇游戏.html',
          createdBy: 'assistant' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          name: '贪吃蛇游戏',
        },
      ];
    },
  };
  const ctx = buildInterruptedRunResumeContext(storage as never, 'bot_x', 'soft_steer');
  assert.match(ctx, /主机恢复上下文/);
  assert.match(ctx, /软接管/);
  assert.match(ctx, /当前任务/);
  assert.match(ctx, /做蛇/);
  assert.match(ctx, /已有资料/);
  assert.match(ctx, /贪吃蛇游戏/);
  assert.match(ctx, /禁止另起炉灶/);
}

{
  const storage = {
    formatTaskProgressForPrompt() {
      return '';
    },
    listOwnerResources() {
      return [];
    },
  };
  const ctx = buildInterruptedRunResumeContext(storage as never, 'bot_y', 'checkpoint');
  assert.match(ctx, /检查点恢复/);
  assert.match(ctx, /暂无条目|无持久任务/);
}

{
  assert.equal(formatRunCheckpointToolDigest(''), '');
  assert.equal(formatRunCheckpointToolDigest('not-json'), '');
  const digest = formatRunCheckpointToolDigest(
    JSON.stringify({
      $schemaVersion: '1',
      generatedItems: [
        { type: 'function_call', name: 'web_fetch', call_id: 'call_abc' },
        { type: 'function_call_result', name: 'web_fetch', call_id: 'call_abc' },
        { rawItem: { type: 'function_call', name: 'write_file', call_id: 'call_def' } },
      ],
    }),
  );
  assert.match(digest, /已发出的工具调用/);
  assert.match(digest, /web_fetch/);
  assert.match(digest, /write_file/);
  assert.match(digest, /call_abc/);
}

{
  const storage = {
    formatTaskProgressForPrompt() {
      return '';
    },
    listOwnerResources() {
      return [];
    },
  };
  const ctx = buildInterruptedRunResumeContext(storage as never, 'bot_z', 'soft_steer', {
    interruptUserText: '先别写了，改成蓝色主题',
    runCheckpoint: {
      runId: 'run_1',
      createdAt: '2026-11-01T00:00:00.000Z',
      toolDigest: formatRunCheckpointToolDigest(
        JSON.stringify({ items: [{ type: 'function_call', name: 'web_fetch', call_id: 'c1' }] }),
      ),
      resumedFromRunState: true,
    },
  });
  assert.match(ctx, /RunState 检查点交接/);
  assert.match(ctx, /续跑/);
  assert.match(ctx, /用户本轮打断消息/);
  assert.match(ctx, /蓝色主题/);
  assert.match(ctx, /web_fetch/);
  assert.match(ctx, /runId=run_1/);
}

{
  const storage = {
    formatTaskProgressForPrompt() {
      return '';
    },
    listOwnerResources() {
      return [];
    },
  };
  const ctx = buildInterruptedRunResumeContext(storage as never, 'bot_stop', 'manual_stop', {
    interruptUserText: '继续',
    runCheckpoint: {
      runId: 'run_stop',
      createdAt: '2026-11-01T00:00:00.000Z',
      toolDigest: '',
      resumedFromRunState: true,
    },
  });
  assert.match(ctx, /手动停止后继续/);
  assert.match(ctx, /继续/);
  assert.match(ctx, /runId=run_stop/);
}

console.log('softSteerResumeContext.test.ts: ok');
