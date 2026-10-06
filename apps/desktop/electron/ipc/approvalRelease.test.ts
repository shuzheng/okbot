import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from '../storage/FileStorage';
import type { PendingHitlRecord } from '../storage/types';
import type { PendingToolApproval } from './context';
import { releaseRunApprovals } from './approvalWaiter';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-release-'));
const storage = new FileStorage(root);
const squadId = 'squad_test1';

const rec = (requestId: string, member: string): PendingHitlRecord => ({
  v: 1,
  requestId,
  messageId: 'msg_1',
  toolName: 'run_shell',
  arguments: '{}',
  serializedRunState: '{}',
  createdAt: new Date().toISOString(),
  squadMember: { botId: member, toolName: `ask_${member}`, task: 't' },
  turnId: 'turn_1',
});

// After a restart two member approvals of one turn wait on disk (A and B).
storage.savePendingHitl(squadId, rec('req_a', 'a'));
storage.savePendingHitl(squadId, rec('req_b', 'b'));
storage.writeSquadResumeReplies(squadId, 'turn_1', [{ memberName: 'X', reply: 'done' }] as never);

// Resuming A clears A first; the resumed run parks one more approval (req_c).
storage.clearPendingHitlRequest(squadId, 'req_a');
storage.savePendingHitl(squadId, rec('req_c', 'a'));
const pendingToolApprovals = new Map<string, PendingToolApproval>();
let rejectedC: { approved: boolean; message?: string } | null = null;
pendingToolApprovals.set('req_c', {
  botId: squadId,
  messageId: 'msg_1',
  toolName: 'run_shell',
  arguments: {},
  resolve: (d) => {
    rejectedC = d;
  },
});

// End of A's resumed run: only its own approvals go away.
releaseRunApprovals({ pendingToolApprovals, storage }, squadId, ['req_c'], '已结束');

assert.deepEqual(
  storage.listPendingHitl(squadId).map((p) => p.requestId),
  ['req_b'],
  'member B approval must survive the end of A',
);
assert.equal(storage.readSquadResumeReplies(squadId, 'turn_1').length, 1, 'collected replies must survive');
assert.equal(pendingToolApprovals.has('req_c'), false);
assert.deepEqual(rejectedC, { approved: false, message: '已结束' });

// Exactly one finalize per turn when captain and member cards wait together.
const { planSquadResumeAfter } = await import('./squadResume');
const member = { squadMember: { botId: 'b', toolName: 'run_shell', task: 't' } };
assert.deepEqual(planSquadResumeAfter('captain', [member]), { dropMemberCards: true, continueCaptain: false });
assert.deepEqual(planSquadResumeAfter('captain', []), { dropMemberCards: false, continueCaptain: false });
assert.deepEqual(planSquadResumeAfter('member', [{}]), { dropMemberCards: false, continueCaptain: false });
assert.deepEqual(planSquadResumeAfter('member', [member]), { dropMemberCards: false, continueCaptain: false });
assert.deepEqual(planSquadResumeAfter('member', []), { dropMemberCards: false, continueCaptain: true });

fs.rmSync(root, { recursive: true, force: true });
console.log('approvalRelease.test.ts: ok');
