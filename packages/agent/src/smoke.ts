/**
 * Smoke test: read model settings from env or ~/.okbot/settings.json
 * and send one Chat Completions request. Does NOT read ~/.codex.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeModelSettings, resolveModelConfig } from '@okbot/shared';
import { runChat } from './index.ts';

async function loadSettings() {
  if (process.env.OKBOT_BASE_URL && process.env.OKBOT_API_KEY && process.env.OKBOT_MODEL) {
    return resolveModelConfig(
      normalizeModelSettings({
        providers: [
          {
            id: 'env',
            name: 'env',
            baseURL: process.env.OKBOT_BASE_URL,
            apiKey: process.env.OKBOT_API_KEY,
            apiFormat: 'chat_completions',
            models: [
              {
                id: process.env.OKBOT_MODEL,
                name: process.env.OKBOT_MODEL,
                contextWindow: 128000,
                maxTokens: null,
                enabled: true,
              },
            ],
          },
        ],
        defaultProviderId: 'env',
        defaultModelId: process.env.OKBOT_MODEL,
      }),
    );
  }
  const p = path.join(os.homedir(), '.okbot', 'settings.json');
  if (!fs.existsSync(p)) {
    console.error('No ~/.okbot/settings.json and no OKBOT_* env. Skip smoke.');
    process.exit(0);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return resolveModelConfig(normalizeModelSettings(raw.model));
}

const model = await loadSettings();
if (!model?.baseURL || !model?.apiKey || !model?.model) {
  console.error('Model settings incomplete. Skip smoke.');
  process.exit(0);
}

let received = '';
const result = await runChat({
  botName: 'SmokeBot',
  botDescription: 'smoke test',
  model,
  history: [],
  userText: '只回复一个词：pong',
  onDelta: (d) => {
    received += d;
    process.stdout.write(d);
  },
});
process.stdout.write('\n');
if (!result.content.trim()) {
  console.error('FAIL: empty content');
  process.exit(1);
}
console.log('SMOKE_OK', { chars: result.content.length, streamed: received.length > 0 });
