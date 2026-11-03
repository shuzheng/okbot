/**
 * P2 regression: same-topic write_file gate must be wired into squad + mesh
 * nested runs the same way as bot turns (libraryWriteGateForOwner →
 * assertLibraryWriteAllowed → buildTools).
 *
 * Source wiring check keeps the host/agent forward path from regressing
 * without standing up a full chat run.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

function readRepo(...parts: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

{
  const startSquad = readRepo('apps/gateway/src/ipc/chat/startSquadTurn.ts');
  assert.match(startSquad, /libraryWriteGateForOwner/);
  assert.match(startSquad, /assertLibraryWriteAllowed/);
  assert.match(startSquad, /runSquadChat\(\{[\s\S]*assertLibraryWriteAllowed/);
}

{
  const squadResume = readRepo('apps/gateway/src/ipc/squadResume.ts');
  assert.match(squadResume, /libraryWriteGateForOwner/);
  assert.match(squadResume, /assertLibraryWriteAllowed/);
  assert.match(squadResume, /const common: RunSquadChatInput = \{[\s\S]*assertLibraryWriteAllowed/);
}

{
  const coldRestoreBot = readRepo('apps/gateway/src/ipc/chat/coldRestoreBot.ts');
  // Mesh nested cold resume must pass the gate into resumeMeshCalleeAfterHitl
  assert.match(
    coldRestoreBot,
    /resumeMeshCalleeAfterHitl\(\{[\s\S]*assertLibraryWriteAllowed: libraryWriteGateForOwner/,
  );
}

{
  const squad = readRepo('packages/agent/src/squad.ts');
  assert.match(squad, /assertLibraryWriteAllowed\?:/);
  // Captain + member buildTools both forward the gate
  const forwards = squad.match(/assertLibraryWriteAllowed: input\.assertLibraryWriteAllowed/g) ?? [];
  assert.equal(forwards.length, 2, 'captain and member buildTools must both pass the gate');
}

{
  const mesh = readRepo('packages/agent/src/mesh.ts');
  assert.match(mesh, /assertLibraryWriteAllowed\?:/);
  const forwards = mesh.match(/assertLibraryWriteAllowed: input\.assertLibraryWriteAllowed/g) ?? [];
  assert.equal(
    forwards.length,
    2,
    'buildAskAssistantTool + resumeMeshCalleeAfterHitl buildTools must both pass the gate',
  );
}

{
  const runAgent = readRepo('packages/agent/src/runAgentChat.ts');
  assert.match(
    runAgent,
    /buildAskAssistantTool\(\{[\s\S]*assertLibraryWriteAllowed: input\.assertLibraryWriteAllowed/,
  );
}

console.log('squadMeshLibraryWriteGate.wiring.test.ts: ok');
