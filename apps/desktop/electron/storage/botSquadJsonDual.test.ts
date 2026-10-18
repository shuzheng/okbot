import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-dual-json-'));
const storage = new FileStorage(root);

const bot = storage.createBot({
  name: 'DualBot',
  description: '初版简介',
  emoji: '🧪',
});

const botJsonPath = path.join(root, bot.id, 'bot.json');
assert.ok(fs.existsSync(botJsonPath), 'createBot must write bot.json');
const createdCfg = JSON.parse(fs.readFileSync(botJsonPath, 'utf8')) as Record<string, unknown>;
assert.equal(createdCfg.name, 'DualBot');
assert.equal(createdCfg.description, '初版简介');
assert.equal(createdCfg.id, bot.id);

storage.updateBot(bot.id, { name: 'DualBot-2', description: '更新后的简介' });
const updatedCfg = JSON.parse(fs.readFileSync(botJsonPath, 'utf8')) as Record<string, unknown>;
assert.equal(updatedCfg.name, 'DualBot-2');
assert.equal(updatedCfg.description, '更新后的简介');

const roster = JSON.parse(fs.readFileSync(path.join(root, 'bots.json'), 'utf8')) as Array<{
  id: string;
  name: string;
  description: string;
}>;
const row = roster.find((r) => r.id === bot.id)!;
assert.equal(row.name, updatedCfg.name);
assert.equal(row.description, updatedCfg.description);

const botB = storage.createBot({ name: 'Peer', description: '队友' });
const squad = storage.createSquad({
  name: 'Crew',
  description: '小队简介',
  members: [
    { botId: bot.id, role: 'lead' },
    { botId: botB.id, role: 'peer' },
  ],
});

const squadJsonPath = path.join(root, squad.id, 'squad.json');
assert.ok(fs.existsSync(squadJsonPath), 'createSquad must write squad.json');
const squadCfg = JSON.parse(fs.readFileSync(squadJsonPath, 'utf8')) as Record<string, unknown>;
assert.equal(squadCfg.id, squad.id);
assert.equal(squadCfg.name, 'Crew');
assert.equal(squadCfg.description, '小队简介');

storage.updateSquad(squad.id, { name: 'Crew-2', description: '小队已改' });
const squadUpdated = JSON.parse(fs.readFileSync(squadJsonPath, 'utf8')) as Record<string, unknown>;
assert.equal(squadUpdated.name, 'Crew-2');
assert.equal(squadUpdated.description, '小队已改');

const squadsCentral = JSON.parse(fs.readFileSync(path.join(root, 'squads.json'), 'utf8')) as Array<{
  id: string;
  name: string;
  description: string;
}>;
const sRow = squadsCentral.find((s) => s.id === squad.id)!;
assert.equal(sRow.name, squadUpdated.name);
assert.equal(sRow.description, squadUpdated.description);

// Shape: bot.json keeps runtime fields + name/description; squad.json is name-card only.
assert.ok(typeof createdCfg.avatarKind === 'string' || typeof updatedCfg.avatarKind === 'string');
assert.equal(Object.keys(squadUpdated).sort().join(','), 'description,id,name');

fs.rmSync(root, { recursive: true, force: true });
console.log('botSquadJsonDual.test.ts: ok');

// --- migration: legacy owners missing / stale name+description ---
{
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-dual-migrate-'));
  const botId = 'bot_20261018_001';
  const squadId = 'squad_20261018_001';
  fs.mkdirSync(path.join(legacyRoot, botId), { recursive: true });
  fs.mkdirSync(path.join(legacyRoot, squadId), { recursive: true });

  // Central roster has the canonical name+description.
  fs.writeFileSync(
    path.join(legacyRoot, 'bots.json'),
    JSON.stringify(
      [{ id: botId, name: 'LegacyBot', description: '来自 bots.json 的简介' }],
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(legacyRoot, 'squads.json'),
    JSON.stringify(
      [
        {
          id: squadId,
          name: 'LegacySquad',
          description: '来自 squads.json 的简介',
          members: [{ botId, role: 'lead' }],
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      null,
      2,
    ),
  );

  // Legacy bot.json: runtime fields only (no name/description).
  fs.writeFileSync(
    path.join(legacyRoot, botId, 'bot.json'),
    JSON.stringify(
      {
        id: botId,
        avatarKind: 'emoji',
        emoji: '🤖',
        color: '',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        onboardingComplete: true,
        useGlobalSkills: false,
        enabledGlobalSkills: [],
      },
      null,
      2,
    ),
  );
  // Stale squad.json with wrong name (and missing description).
  fs.writeFileSync(
    path.join(legacyRoot, squadId, 'squad.json'),
    JSON.stringify({ id: squadId, name: '旧名字' }, null, 2),
  );

  // Init runs syncAllOwnerConfigNameDescriptions.
  const legacy = new FileStorage(legacyRoot);

  const botCfg = JSON.parse(
    fs.readFileSync(path.join(legacyRoot, botId, 'bot.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(botCfg.name, 'LegacyBot');
  assert.equal(botCfg.description, '来自 bots.json 的简介');
  assert.equal(botCfg.emoji, '🤖', 'runtime fields must be preserved');

  const squadCfg = JSON.parse(
    fs.readFileSync(path.join(legacyRoot, squadId, 'squad.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(squadCfg.name, 'LegacySquad');
  assert.equal(squadCfg.description, '来自 squads.json 的简介');
  assert.equal(squadCfg.id, squadId);

  // Every-load safe: listBots/listSquads must not thrash mtime when already in sync.
  const botMtimeBefore = fs.statSync(path.join(legacyRoot, botId, 'bot.json')).mtimeMs;
  const squadMtimeBefore = fs.statSync(path.join(legacyRoot, squadId, 'squad.json')).mtimeMs;
  legacy.listBots();
  legacy.listSquads();
  assert.equal(
    fs.statSync(path.join(legacyRoot, botId, 'bot.json')).mtimeMs,
    botMtimeBefore,
    'listBots must not rewrite when already synced',
  );
  assert.equal(
    fs.statSync(path.join(legacyRoot, squadId, 'squad.json')).mtimeMs,
    squadMtimeBefore,
    'listSquads must not rewrite when already synced',
  );

  // Stale after central roster edit without going through updateBot:
  const roster = JSON.parse(
    fs.readFileSync(path.join(legacyRoot, 'bots.json'), 'utf8'),
  ) as Array<{ id: string; name: string; description: string }>;
  roster[0]!.name = 'RenamedViaRoster';
  roster[0]!.description = '手改 roster';
  fs.writeFileSync(path.join(legacyRoot, 'bots.json'), JSON.stringify(roster, null, 2));
  legacy.listBots();
  const afterList = JSON.parse(
    fs.readFileSync(path.join(legacyRoot, botId, 'bot.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(afterList.name, 'RenamedViaRoster');
  assert.equal(afterList.description, '手改 roster');

  fs.rmSync(legacyRoot, { recursive: true, force: true });
  console.log('botSquadJsonDual.test.ts migration: ok');
}
