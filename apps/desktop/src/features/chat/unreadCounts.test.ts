import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countAssistantRepliesAfter, countUnreadSessions } from './unreadCounts';

describe('countUnreadSessions', () => {
  it('sums bots and squads with hasUnreadReply', () => {
    assert.equal(
      countUnreadSessions(
        [{ hasUnreadReply: true }, {}, { hasUnreadReply: true }],
        [{ hasUnreadReply: true }, { hasUnreadReply: false as unknown as undefined }],
      ),
      3,
    );
  });

  it('returns 0 when none unread', () => {
    assert.equal(countUnreadSessions([{ id: 'a' } as never], []), 0);
  });
});

describe('countAssistantRepliesAfter', () => {
  const msgs = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' },
    { id: 'a2', role: 'assistant' },
    { id: 'mesh', role: 'assistant', meshExchange: { exchangeId: 'x' } },
    { id: 'a3', role: 'assistant' },
  ];

  it('counts assistant replies after anchor, skipping mesh chips', () => {
    assert.equal(countAssistantRepliesAfter(msgs, 'a1'), 2);
    assert.equal(countAssistantRepliesAfter(msgs, 'u2'), 2);
    assert.equal(countAssistantRepliesAfter(msgs, 'a2'), 1);
  });

  it('returns 0 without anchor or when anchor missing', () => {
    assert.equal(countAssistantRepliesAfter(msgs, null), 0);
    assert.equal(countAssistantRepliesAfter(msgs, 'gone'), 0);
  });
});
