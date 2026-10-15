import assert from 'node:assert/strict';
import {
  createMeshFollowUpStripper,
  stripLeadingCommittedInterim,
} from './meshCommit.js';

{
  const interim = '好的，再让写作助手介绍一次。';
  const full =
    '好的，再让写作助手介绍一次。它说：\n\n> 我是你的写作助手';
  const stripped = stripLeadingCommittedInterim(full, interim);
  assert.equal(stripped.startsWith('它说：'), true);
  assert.equal(stripped.includes('再让写作助手介绍一次'), false);
}

{
  assert.equal(stripLeadingCommittedInterim('独立回答', '好的，去请教。'), '独立回答');
  assert.equal(stripLeadingCommittedInterim('好的，去请教。', '好的，去请教。'), '');
  assert.equal(stripLeadingCommittedInterim('好的', '好的，去请教。'), '');
}

{
  const stripper = createMeshFollowUpStripper();
  const interim = '好的，再让写作助手介绍一次。';
  stripper.noteCommitted(interim);
  assert.equal(stripper.acceptDelta('好的，'), null);
  assert.equal(stripper.acceptDelta('再让写作助手介绍一次。'), null);
  const rest = stripper.acceptDelta('它说：hello');
  assert.equal(rest, '它说：hello');
}

{
  const stripper = createMeshFollowUpStripper();
  stripper.noteCommitted('先去问问。');
  // Model does not repeat — diverges immediately
  assert.equal(stripper.acceptDelta('对方说：ok'), '对方说：ok');
}

{
  const stripper = createMeshFollowUpStripper();
  stripper.noteCommitted('好的。');
  assert.equal(stripper.acceptDelta('好'), null);
  // Stream ends mid-prefix
  assert.equal(stripper.finalize(''), '');
}

console.log('meshCommit.test.ts: ok');
