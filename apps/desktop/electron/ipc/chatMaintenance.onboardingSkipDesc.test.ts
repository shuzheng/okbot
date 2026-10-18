/**
 * Post onboarding_skip: first real user reply must force roster description
 * refresh even when SOUL throttle would skip (soulEveryTurns default 5).
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  clearPendingDescriptionAfterOnboardingSkip,
  hasPendingDescriptionAfterOnboardingSkip,
  markPendingDescriptionAfterOnboardingSkip,
  resetPendingDescriptionAfterOnboardingSkipForTests,
} from '../contextMaterials';

describe('pending description after onboarding_skip', () => {
  beforeEach(() => {
    resetPendingDescriptionAfterOnboardingSkipForTests();
  });

  it('marks and reports pending for a bot id', () => {
    assert.equal(hasPendingDescriptionAfterOnboardingSkip('bot-a'), false);
    markPendingDescriptionAfterOnboardingSkip('bot-a');
    assert.equal(hasPendingDescriptionAfterOnboardingSkip('bot-a'), true);
    assert.equal(hasPendingDescriptionAfterOnboardingSkip('bot-b'), false);
  });

  it('clears only the targeted bot', () => {
    markPendingDescriptionAfterOnboardingSkip('bot-a');
    markPendingDescriptionAfterOnboardingSkip('bot-b');
    clearPendingDescriptionAfterOnboardingSkip('bot-a');
    assert.equal(hasPendingDescriptionAfterOnboardingSkip('bot-a'), false);
    assert.equal(hasPendingDescriptionAfterOnboardingSkip('bot-b'), true);
  });

  it('ignores blank ids', () => {
    markPendingDescriptionAfterOnboardingSkip('  ');
    assert.equal(hasPendingDescriptionAfterOnboardingSkip(''), false);
  });
});
