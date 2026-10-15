import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSessionDraftPreview } from './formatSessionDraftPreview';

describe('formatSessionDraftPreview', () => {
  it('returns null for empty / whitespace-only', () => {
    assert.equal(formatSessionDraftPreview(''), null);
    assert.equal(formatSessionDraftPreview('   '), null);
    assert.equal(formatSessionDraftPreview('\n\t  \n'), null);
  });

  it('trims and collapses internal whitespace / newlines', () => {
    assert.equal(formatSessionDraftPreview('  hello  world  '), 'hello world');
    assert.equal(formatSessionDraftPreview('line1\nline2\n\nline3'), 'line1 line2 line3');
    assert.equal(formatSessionDraftPreview('\u3000全角\u3000'), '全角');
  });

  it('keeps meaningful punctuation and CJK', () => {
    assert.equal(formatSessionDraftPreview('草稿内容，继续'), '草稿内容，继续');
  });
});
