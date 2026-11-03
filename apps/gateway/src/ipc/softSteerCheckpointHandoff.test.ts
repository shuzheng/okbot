/**
 * Soft-steer and manual Stop keep mid-run checkpoint; success / consume-once clear it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from '../storage/FileStorage';
import { abortChatOwner } from './chatControl';
import {
  clearSoftSteerCheckpointHandoff,
  hasSoftSteerCheckpointHandoff,
  markSoftSteerCheckpointHandoff,
  resetSoftSteerStateForTests,
  shouldKeepRunCheckpointOnTurnEnd,
  softSteerNewestRun,
} from './softSteerGate';
import {
  registerOwnerRun,
  resetOwnerRunQueuesForTests,
  unregisterOwnerRun,
  type AbortControllerMap,
} from './ownerRuns';
import {
  isComposerChatOrigin,
  mayConsumeKeptRunCheckpoint,
} from './chat/turnContext';

resetSoftSteerStateForTests();
resetOwnerRunQueuesForTests();

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-steer-ckpt-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 't' });

storage.saveRunCheckpoint(bot.id, {
  kind: 'bot',
  runId: 'run_old',
  messageId: 'msg_old',
  serializedRunState: JSON.stringify({
    $schemaVersion: 'test',
    generatedItems: [{ type: 'function_call', name: 'web_fetch', call_id: 'c1' }],
  }),
  createdAt: new Date().toISOString(),
});
assert.ok(storage.loadRunCheckpoint(bot.id));

// Soft-steer abort keeps checkpoint when handoff is marked.
{
  const map: AbortControllerMap = new Map();
  const ctrl = new AbortController();
  registerOwnerRun(map, bot.id, 'run_old', ctrl);
  markSoftSteerCheckpointHandoff(bot.id);
  assert.equal(hasSoftSteerCheckpointHandoff(bot.id), true);

  // Simulate aborted turn finally: keep when handoff set / aborted.
  ctrl.abort();
  if (
    !shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: false,
      aborted: ctrl.signal.aborted,
    })
  ) {
    storage.clearRunCheckpoint(bot.id);
  }
  assert.ok(storage.loadRunCheckpoint(bot.id), 'soft-steer abort must keep checkpoint');

  unregisterOwnerRun(map, bot.id, 'run_old', ctrl);
}

// Replacement turn consumes once.
{
  const loaded = storage.loadRunCheckpoint(bot.id);
  assert.ok(loaded?.serializedRunState);
  storage.clearRunCheckpoint(bot.id);
  clearSoftSteerCheckpointHandoff(bot.id);
  assert.equal(storage.loadRunCheckpoint(bot.id), null);
  assert.equal(hasSoftSteerCheckpointHandoff(bot.id), false);
}

// Stop keeps checkpoint (and clears soft-steer handoff flag only).
{
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_stop',
    messageId: 'msg_stop',
    serializedRunState: '{"state":1}',
    createdAt: new Date().toISOString(),
  });
  markSoftSteerCheckpointHandoff(bot.id);
  const map: AbortControllerMap = new Map();
  const ctrl = new AbortController();
  registerOwnerRun(map, bot.id, 'run_stop', ctrl);
  const ctx = {
    abortControllers: map,
    rejectPendingApprovalsForBot: () => undefined,
    storage,
  };
  assert.equal(abortChatOwner(ctx as never, bot.id), true);
  assert.equal(hasSoftSteerCheckpointHandoff(bot.id), false, 'Stop clears soft-steer handoff flag');
  assert.ok(storage.loadRunCheckpoint(bot.id), 'Stop must keep checkpoint for later continue');
  // Aborted turn finally would also keep:
  assert.equal(
    shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: false,
      aborted: true,
    }),
    true,
  );
  unregisterOwnerRun(map, bot.id, 'run_stop', ctrl);
}

// Subsequent resume/consume after Stop can clear it (composer continue path).
{
  const loaded = storage.loadRunCheckpoint(bot.id);
  assert.ok(loaded?.serializedRunState, 'ckpt still present after Stop');
  // Simulate startBotTurn consume-once on later composer continue:
  storage.clearRunCheckpoint(bot.id);
  assert.equal(storage.loadRunCheckpoint(bot.id), null, 'resume consume-once clears ckpt');
  // Successful finish with no handoff also clears (idempotent):
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_after_resume',
    messageId: 'msg_after',
    serializedRunState: '{"state":"mid"}',
    createdAt: new Date().toISOString(),
  });
  assert.equal(
    shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: false,
      aborted: false,
    }),
    false,
  );
  storage.clearRunCheckpoint(bot.id);
  assert.equal(storage.loadRunCheckpoint(bot.id), null);
}

// softSteerNewestRun marks handoff when it aborts in-flight work.
{
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_live',
    messageId: 'msg_live',
    serializedRunState: '{"state":2}',
    createdAt: new Date().toISOString(),
  });
  const map: AbortControllerMap = new Map();
  const ctrl = new AbortController();
  registerOwnerRun(map, bot.id, 'run_live', ctrl);
  const pending = softSteerNewestRun({ abortControllers: map }, bot.id);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ctrl.signal.aborted, true);
  unregisterOwnerRun(map, bot.id, 'run_live', ctrl);
  const result = await pending;
  assert.equal(result.steered, true);
  assert.equal(result.superseded, false);
  assert.equal(hasSoftSteerCheckpointHandoff(bot.id), true);
  // Simulated aborted finally keeps ckpt
  if (
    !shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: false,
      aborted: true,
    })
  ) {
    storage.clearRunCheckpoint(bot.id);
  }
  assert.ok(storage.loadRunCheckpoint(bot.id));
  clearSoftSteerCheckpointHandoff(bot.id);
}

// SoftSteered replacement that fails before consume abandons handoff (not sticky).
{
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_fail_before_consume',
    messageId: 'msg_fail',
    serializedRunState: '{"state":3}',
    createdAt: new Date().toISOString(),
  });
  markSoftSteerCheckpointHandoff(bot.id);
  assert.equal(hasSoftSteerCheckpointHandoff(bot.id), true);
  assert.ok(storage.loadRunCheckpoint(bot.id));

  // Simulate startBotTurn finally for a softSteered replacement that threw
  // before clearSoftSteerCheckpointHandoff / consume (e.g. compress error).
  const softSteered = true;
  const aborted = false;
  if (
    shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered,
      aborted,
    })
  ) {
    // keep — must not happen for fail-before-consume
  } else {
    if (softSteered) clearSoftSteerCheckpointHandoff(bot.id);
    storage.clearRunCheckpoint(bot.id);
  }
  assert.equal(hasSoftSteerCheckpointHandoff(bot.id), false, 'fail-before-consume must clear handoff');
  assert.equal(storage.loadRunCheckpoint(bot.id), null, 'fail-before-consume must abandon ckpt');

  // Later successful finish (no handoff) clears — not sticky forever.
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_later',
    messageId: 'msg_later',
    serializedRunState: '{"state":4}',
    createdAt: new Date().toISOString(),
  });
  if (
    shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: false,
      aborted: false,
    })
  ) {
    // would keep — must not happen after abandon
  } else {
    storage.clearRunCheckpoint(bot.id);
  }
  assert.equal(storage.loadRunCheckpoint(bot.id), null, 'later successful finish must clear ckpt');
}

// Aborted turn (!softSteered) still keeps checkpoint while handoff marked.
{
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_aborted_keep',
    messageId: 'msg_aborted',
    serializedRunState: '{"state":5}',
    createdAt: new Date().toISOString(),
  });
  markSoftSteerCheckpointHandoff(bot.id);
  const softSteered = false;
  const aborted = true;
  if (
    shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered,
      aborted,
    })
  ) {
    // keep
  } else {
    if (softSteered) clearSoftSteerCheckpointHandoff(bot.id);
    storage.clearRunCheckpoint(bot.id);
  }
  assert.equal(hasSoftSteerCheckpointHandoff(bot.id), true);
  assert.ok(storage.loadRunCheckpoint(bot.id), 'aborted turn must keep ckpt for handoff');
  clearSoftSteerCheckpointHandoff(bot.id);
  storage.clearRunCheckpoint(bot.id);
}

// Stop during softSteered replacement also keeps ckpt (aborted=true).
{
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_steered_stop',
    messageId: 'msg_steered_stop',
    serializedRunState: '{"state":6}',
    createdAt: new Date().toISOString(),
  });
  assert.equal(
    shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: true,
      aborted: true,
    }),
    true,
    'Stop mid soft-steered turn must keep ckpt',
  );
  assert.ok(storage.loadRunCheckpoint(bot.id));
  storage.clearRunCheckpoint(bot.id);
}

// After Stop, reaction must not consume leftover ckpt; composer may; softSteered may.
{
  assert.equal(isComposerChatOrigin('reaction'), true, 'reaction still soft-steer eligible');
  assert.equal(isComposerChatOrigin('composer'), true);
  assert.equal(isComposerChatOrigin(undefined), true);
  assert.equal(isComposerChatOrigin('schedule'), false);

  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_after_stop_reaction',
    messageId: 'msg_after_stop_reaction',
    serializedRunState: '{"state":"stop-left"}',
    createdAt: new Date().toISOString(),
  });
  assert.ok(storage.loadRunCheckpoint(bot.id));

  // Simulate startBotTurn gate for a quiet reaction wake after Stop (idle → !softSteered).
  const reactionMay = mayConsumeKeptRunCheckpoint('reaction', false);
  assert.equal(reactionMay, false, 'reaction must not consume Stop leftover ckpt');
  if (reactionMay) {
    storage.clearRunCheckpoint(bot.id);
  }
  assert.ok(storage.loadRunCheckpoint(bot.id), 'reaction turn must leave Stop ckpt intact');

  // Soft-steered reaction (busy handoff) still consumes.
  assert.equal(
    mayConsumeKeptRunCheckpoint('reaction', true),
    true,
    'soft-steered reaction may consume handoff ckpt',
  );

  // Real composer continue consumes once.
  const composerMay = mayConsumeKeptRunCheckpoint('composer', false);
  assert.equal(composerMay, true, 'composer continue may consume Stop leftover');
  if (composerMay) {
    const loaded = storage.loadRunCheckpoint(bot.id);
    assert.ok(loaded?.serializedRunState);
    storage.clearRunCheckpoint(bot.id);
  }
  assert.equal(storage.loadRunCheckpoint(bot.id), null, 'composer consume-once clears ckpt');

  assert.equal(mayConsumeKeptRunCheckpoint(undefined, false), true);
  assert.equal(mayConsumeKeptRunCheckpoint('schedule', false), false);
  assert.equal(mayConsumeKeptRunCheckpoint('api', false), false);
  assert.equal(mayConsumeKeptRunCheckpoint('auto_continue', false), false);
}

// Reaction successful finish (finally path) must not clear Stop leftover ckpt.
// mayConsume blocks consume-at-start; shouldKeep must also preserve foreign runId.
{
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_stop_leftover_finally',
    messageId: 'msg_stop_leftover_finally',
    serializedRunState: '{"state":"stop-left-finally"}',
    createdAt: new Date().toISOString(),
  });
  const reactionRunId = 'run_reaction_success';
  const existing = storage.loadRunCheckpoint(bot.id);
  assert.ok(existing?.runId);
  assert.equal(
    shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: false,
      aborted: false,
      currentRunId: reactionRunId,
      existingCheckpointRunId: existing?.runId,
    }),
    true,
    'reaction successful finish must keep unconsumed Stop leftover ckpt',
  );
  // Simulate startBotTurn finally keep branch:
  if (
    !shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: false,
      aborted: false,
      currentRunId: reactionRunId,
      existingCheckpointRunId: existing?.runId,
    })
  ) {
    storage.clearRunCheckpoint(bot.id);
  }
  assert.ok(
    storage.loadRunCheckpoint(bot.id),
    'finally must leave Stop leftover intact after reaction success',
  );

  // Same reaction run wrote its own mid-run ckpt → successful finish clears it.
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: reactionRunId,
    messageId: 'msg_reaction_mid',
    serializedRunState: '{"state":"reaction-own"}',
    createdAt: new Date().toISOString(),
  });
  assert.equal(
    shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: false,
      aborted: false,
      currentRunId: reactionRunId,
      existingCheckpointRunId: reactionRunId,
    }),
    false,
    'reaction own mid-run ckpt on success must clear',
  );
  if (
    !shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: false,
      aborted: false,
      currentRunId: reactionRunId,
      existingCheckpointRunId: reactionRunId,
    })
  ) {
    storage.clearRunCheckpoint(bot.id);
  }
  assert.equal(storage.loadRunCheckpoint(bot.id), null);

  // softSteered fail-before-consume with foreign ckpt still abandons (not sticky).
  storage.saveRunCheckpoint(bot.id, {
    kind: 'bot',
    runId: 'run_old_foreign',
    messageId: 'msg_old_foreign',
    serializedRunState: '{"state":"foreign"}',
    createdAt: new Date().toISOString(),
  });
  assert.equal(
    shouldKeepRunCheckpointOnTurnEnd({
      ownerId: bot.id,
      softSteered: true,
      aborted: false,
      currentRunId: 'run_steered_fail',
      existingCheckpointRunId: 'run_old_foreign',
    }),
    false,
    'softSteered fail-before-consume must still clear foreign ckpt',
  );
  storage.clearRunCheckpoint(bot.id);
}

fs.rmSync(root, { recursive: true, force: true });
console.log('softSteerCheckpointHandoff.test.ts: ok');
