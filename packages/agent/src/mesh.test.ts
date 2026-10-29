import assert from 'node:assert/strict';
import {
  canAskMeshPeer,
  formatPeerRosterSection,
  resolveMeshPeer,
  buildMeshCalleeInstructions,
  MESH_ASK_TOOL_NAME,
  MESH_USER_FACING_REPLY_RULE,
} from './mesh.js';
import { DEFAULT_TOOL_PREFERENCES } from '@okbot/shared';

const peers = [
  { id: 'bot_a', name: 'Alice', description: '调研与检索' },
  { id: 'bot_b', name: 'Bob', description: '写代码' },
  { id: 'bot_c', name: 'Carol', description: '翻译' },
  { id: 'bot_dup', name: 'Alice', description: '同名另一人' },
];

{
  const text = formatPeerRosterSection(peers.slice(0, 2));
  assert.match(text, /其他助手/);
  assert.match(text, /Alice/);
  assert.match(text, /调研与检索/);
  assert.match(text, /仅以本节当前名单为准/);
  assert.match(text, /不要依据更早对话或旧名单/);
  assert.match(text, /优先向该助手求助/);
  assert.match(text, /没有合适伙伴/);
  assert.doesNotMatch(text, /能自己完成时优先自己做/);
  assert.doesNotMatch(text, /ask_assistant/);
  assert.match(text, /Bob/);
  assert.match(text, /不要提及工具名称/);
  assert.ok(!MESH_USER_FACING_REPLY_RULE.includes('ask_assistant'));
}

{
  const empty = formatPeerRosterSection([]);
  assert.match(empty, /没有其他可求助的助手/);
  assert.match(empty, /仅以本节当前名单为准/);
  assert.doesNotMatch(empty, /ask_assistant/);
}

{
  const byName = resolveMeshPeer(peers.slice(0, 3), 'Bob');
  assert.equal(byName.ok, true);
  if (byName.ok) assert.equal(byName.peer.id, 'bot_b');

  const byId = resolveMeshPeer(peers.slice(0, 3), 'bot_c');
  assert.equal(byId.ok, true);
  if (byId.ok) assert.equal(byId.peer.id, 'bot_c');

  const missing = resolveMeshPeer(peers.slice(0, 3), 'Dave');
  assert.equal(missing.ok, false);

  const amb = resolveMeshPeer(peers, 'Alice');
  assert.equal(amb.ok, false);
  if (!amb.ok) assert.match(amb.error, /同名/);
}

{
  // Deep nesting still allowed: A→B→C→D
  const ok = canAskMeshPeer({
    stack: ['bot_a', 'bot_b', 'bot_c'],
    targetId: 'bot_d',
  });
  assert.equal(ok.ok, true);
}

{
  // Cycle A→B→A blocked
  const cycle = canAskMeshPeer({
    stack: ['bot_a', 'bot_b'],
    targetId: 'bot_a',
  });
  assert.equal(cycle.ok, false);
  if (!cycle.ok) assert.match(cycle.error, /循环/);
}

{
  // Self / same callee A→B→B blocked
  const self = canAskMeshPeer({
    stack: ['bot_a', 'bot_b'],
    targetId: 'bot_b',
  });
  assert.equal(self.ok, false);
}

{
  const withAsk = buildMeshCalleeInstructions({
    calleeName: 'Bob',
    calleeDescription: 'code',
    callerName: 'Alice',
    prefs: DEFAULT_TOOL_PREFERENCES,
    peerRoster: peers.slice(0, 3).filter((p) => p.id !== 'bot_b'),
    askEnabled: true,
  });
  assert.match(withAsk, /协助助手/);
  assert.match(withAsk, /优先向该助手求助/);
  assert.doesNotMatch(withAsk, /能自己完成时优先自己做/);
  assert.doesNotMatch(withAsk, /ask_assistant/);
  assert.match(withAsk, /Alice/);
  assert.match(withAsk, /不要提及工具名称/);

  const noAsk = buildMeshCalleeInstructions({
    calleeName: 'Carol',
    calleeDescription: '翻译',
    callerName: 'Bob',
    prefs: DEFAULT_TOOL_PREFERENCES,
    askEnabled: false,
  });
  assert.match(noAsk, /不能再向其他助手求助/);
  assert.doesNotMatch(noAsk, /ask_assistant/);
  assert.doesNotMatch(noAsk, /其他助手（可求助）/);
}

assert.equal(MESH_ASK_TOOL_NAME, 'ask_assistant');

console.log('mesh.test.ts: ok');
