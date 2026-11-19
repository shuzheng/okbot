import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  notifyBodyFromReply,
  pickNotifyReplyBody,
  visibleReplyStoreKey,
} from './notifyReplyBody';

describe('visibleReplyStoreKey', () => {
  it('scopes by runId when present', () => {
    assert.equal(visibleReplyStoreKey('bot_1', 'run_a'), 'bot_1:run_a');
    assert.equal(visibleReplyStoreKey('bot_1', '  run_a  '), 'bot_1:run_a');
  });

  it('falls back to botId when runId is missing', () => {
    assert.equal(visibleReplyStoreKey('bot_1'), 'bot_1');
    assert.equal(visibleReplyStoreKey('bot_1', ''), 'bot_1');
    assert.equal(visibleReplyStoreKey('bot_1', '   '), 'bot_1');
  });
});

describe('notifyBodyFromReply', () => {
  it('returns empty for blank, whitespace, or think-only content', () => {
    assert.equal(notifyBodyFromReply(''), '');
    assert.equal(notifyBodyFromReply('   \n\t  '), '');
    assert.equal(notifyBodyFromReply('<think>internal plan</think>'), '');
    assert.equal(notifyBodyFromReply('<think>still thinking'), '');
  });

  it('strips markdown and think tags, then collapses whitespace', () => {
    assert.equal(
      notifyBodyFromReply('<think>plan</think>**已改好**，请看 `okbot-dev`。'),
      '已改好，请看 okbot-dev。',
    );
    assert.equal(notifyBodyFromReply('第一行\n\n第二行'), '第一行 第二行');
  });

  it('truncates cleanly at the notification limit', () => {
    const long = '字'.repeat(200);
    const body = notifyBodyFromReply(long);
    assert.equal(body.length, 180);
    assert.equal(body.endsWith('…'), true);
    assert.equal(body.slice(0, 179), '字'.repeat(179));
  });
});

describe('pickNotifyReplyBody', () => {
  it('prefers the last visible send_message bubble over leftover done text', () => {
    assert.equal(
      pickNotifyReplyBody({
        lastVisibleReply: '置顶成员名称已改成和普通成员一样。',
        doneContent: '已发送。',
      }),
      '置顶成员名称已改成和普通成员一样。',
    );
  });

  it('uses done content when this turn has no send_message bubble', () => {
    assert.equal(
      pickNotifyReplyBody({
        lastVisibleReply: '',
        doneContent: '## 结论\n\n可以开始。',
      }),
      '结论 可以开始。',
    );
  });

  it('returns empty instead of a fixed completion phrase when nothing is usable', () => {
    assert.equal(pickNotifyReplyBody({ lastVisibleReply: '  ', doneContent: '<think>x</think>' }), '');
    assert.equal(pickNotifyReplyBody({}), '');
  });
});
