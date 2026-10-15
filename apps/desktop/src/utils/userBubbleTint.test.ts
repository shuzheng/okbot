import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAvatarAccentHex, userBubbleTintStyle } from './userBubbleTint';

describe('userBubbleTint', () => {
  it('accepts #RRGGBB only', () => {
    assert.equal(isAvatarAccentHex('#3B82F6'), true);
    assert.equal(isAvatarAccentHex('#ffffff'), true);
    assert.equal(isAvatarAccentHex(''), false);
    assert.equal(isAvatarAccentHex(undefined), false);
    assert.equal(isAvatarAccentHex('#fff'), false);
    assert.equal(isAvatarAccentHex('3B82F6'), false);
    assert.equal(isAvatarAccentHex('blue'), false);
  });

  it('returns style only for valid accents', () => {
    assert.equal(userBubbleTintStyle(''), undefined);
    assert.equal(userBubbleTintStyle(undefined), undefined);
    assert.deepEqual(userBubbleTintStyle('#6366F1'), {
      '--user-bubble-accent': '#6366F1',
    });
  });
});
