import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from '../electron/storage';
import { normalizeModelSettings } from '@okbot/shared';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-st-'));
const s = new FileStorage(root);
const bot = s.createBot({ name: '测', description: 'd', emoji: '🦊' });
const today = (() => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
})();
if (!new RegExp(`^bot_${today}_\\d+$`).test(bot.id)) throw new Error(`bad bot id format: ${bot.id}`);
if (bot.id !== `bot_${today}_001`) throw new Error(`expected first id bot_${today}_001 got ${bot.id}`);
const bot2 = s.createBot({ name: '测2' });
if (bot2.id !== `bot_${today}_002`) throw new Error(`expected second id bot_${today}_002 got ${bot2.id}`);
// leftover dir not in roster should bump seq
const leftover = path.join(root, `bot_${today}_010`);
fs.mkdirSync(leftover);
const bot3 = s.createBot({ name: '测3' });
if (bot3.id !== `bot_${today}_011`) throw new Error(`expected id after leftover dir bot_${today}_011 got ${bot3.id}`);
if (!fs.existsSync(path.join(root, bot.id, 'session.jsonl'))) throw new Error('no session file');
if (!fs.existsSync(path.join(root, bot.id, 'AGENTS.md'))) throw new Error('no AGENTS.md');
if (!s.readAgentsMd(bot.id).includes('角色与目标')) throw new Error('bad AGENTS.md');
s.appendMessage(bot.id, {
  id: '1',
  role: 'user',
  content: 'hi',
  createdAt: new Date().toISOString(),
});
if (s.getMessages(bot.id).length !== 1) throw new Error('msgs');
const squad = s.createSquad({
  name: '小队',
  description: 'd',
  members: [
    { botId: bot.id, role: '调研' },
    { botId: bot2.id, role: '打手' },
  ],
  providerId: '',
  modelId: '',
});
if (!new RegExp(`^squad_${today}_\\d+$`).test(squad.id)) throw new Error(`bad squad id: ${squad.id}`);
if (s.listSquads().length !== 1) throw new Error('squads');
if (!fs.existsSync(path.join(root, squad.id, 'session.jsonl'))) throw new Error('no squad session file');
if ((squad as { leaderBotId?: string }).leaderBotId) throw new Error('legacy leaderBotId should be gone');
if (squad.members.length !== 2) throw new Error('members');
if (!s.getSettings().squad.captainPersona) throw new Error('squad settings defaults');
s.saveSettings({
  ...s.getSettings(),
  theme: 'dark',
  model: {
    providers: [{
      id: 'prov_test',
      name: '默认',
      baseURL: 'http://x',
      apiKey: 'k',
      apiFormat: 'chat_completions',
      models: [{ id: 'm', name: 'm', contextWindow: 128000, maxTokens: null, enabled: true }],
    }],
    defaultProviderId: 'prov_test',
    defaultModelId: 'm',
  },
});
if (s.getSettings().theme !== 'dark') throw new Error('settings');
s.updateBot(bot.id, { name: '测2' });
if (s.listBots().find((b) => b.id === bot.id)?.name !== '测2') throw new Error('update');
// Multi-provider normalize: legacy flat → one provider
{
  const migrated = normalizeModelSettings({
    baseURL: 'http://legacy',
    apiKey: 'secret',
    apiFormat: 'chat_completions',
    models: [{ id: 'a', name: 'A', contextWindow: 8000, maxTokens: null, enabled: true }],
    defaultModelId: 'a',
  });
  if (migrated.providers.length !== 1) throw new Error('legacy migrate providers');
  if (migrated.providers[0]!.baseURL !== 'http://legacy') throw new Error('legacy migrate baseURL');
  if (migrated.defaultModelId !== 'a') throw new Error('legacy migrate default');
  if (!('providers' in migrated)) throw new Error('providers missing');
  // Round-trip via FileStorage should persist providers shape.
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
  if (!Array.isArray(raw.model?.providers)) throw new Error('settings.json still flat model');
}
console.log('STORAGE_SMOKE_OK');
