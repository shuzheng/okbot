/**
 * Regression: prefs may enable generate_image while inferImageCapability is null
 * (non-Images host, no dall-e* / gpt-image* catalog heuristic). Prompt listing and
 * buildTools must agree (prefs-only, like web_search) — otherwise the model calls a
 * missing tool and the Agents SDK throws "Tool generate_image not found in agent".
 * Unsupported providers still register; execute returns a clear error.
 */
import assert from 'node:assert/strict';
import { DEFAULT_TOOL_PREFERENCES, DEFAULT_SECURITY } from '@okbot/shared';
import { listEnabledToolIds, formatEnabledLocalToolsLine, buildAgentInstructions } from './instructions.js';
import { buildTools, resolveImageCapability } from './tools.js';
import { formatComputerRoutingSection, shellFsRoutingSection } from './computerSelection.js';

const prefsOn = {
  ...DEFAULT_TOOL_PREFERENCES,
  generate_image: { enabled: true, approval: 'allow' as const },
};

const prefsOff = {
  ...DEFAULT_TOOL_PREFERENCES,
  generate_image: { enabled: false, approval: 'allow' as const },
};

// Capable via openai_images host heuristic (api.openai.com).
const imagesHostApi = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  catalogModelIds: ['chat-model-a'],
  providerName: 'Images Host',
};

// Chat-only: generic host, no dall-e* / gpt-image* catalog entries.
const chatOnlyApi = {
  baseURL: 'https://api.example-llm.test/v1',
  apiKey: 'sk-test',
  catalogModelIds: ['chat-model-a'],
  providerName: 'Chat Only Provider',
};

assert.equal(resolveImageCapability(imagesHostApi) != null, true);
assert.equal(resolveImageCapability(chatOnlyApi) != null, false);
assert.equal(resolveImageCapability(undefined) != null, false);
assert.equal(resolveImageCapability({ baseURL: '', apiKey: 'x' }) != null, false);

const otherChatOnlyApi = {
  baseURL: 'https://gateway.example.test/v1',
  apiKey: 'sk-test',
  catalogModelIds: ['chat-model-b'],
  providerName: 'Another Chat Provider',
};
assert.equal(resolveImageCapability(otherChatOnlyApi) != null, false);

// Prompt list: prefs-only (imageCapable ignored).
assert.equal(listEnabledToolIds(prefsOn).includes('generate_image'), true);
assert.equal(listEnabledToolIds(prefsOn, { imageCapable: false }).includes('generate_image'), true);
assert.equal(listEnabledToolIds(prefsOn, { imageCapable: true }).includes('generate_image'), true);
assert.equal(listEnabledToolIds(prefsOff).includes('generate_image'), false);

assert.equal(formatEnabledLocalToolsLine(prefsOn).includes('generate_image'), true);
assert.equal(
  formatEnabledLocalToolsLine(prefsOn, { imageCapable: false }).includes('generate_image'),
  true,
);

const instrPrefsOn = buildAgentInstructions('t', '', [], prefsOn);
assert.equal(instrPrefsOn.includes('generate_image'), true);
assert.equal(instrPrefsOn.includes('禁止用 SVG'), true);

const instrPrefsOff = buildAgentInstructions('t', '', [], prefsOff);
assert.equal(instrPrefsOff.includes('generate_image'), false);

// buildTools registration must match the prompt gate (prefs-only).
const toolsImagesHost = buildTools(prefsOn, DEFAULT_SECURITY, undefined, { imageApi: imagesHostApi });
assert.equal(
  toolsImagesHost.some((t) => (t as { name?: string }).name === 'generate_image'),
  true,
  'Images-capable host must register generate_image',
);

const toolsChatOnly = buildTools(prefsOn, DEFAULT_SECURITY, undefined, { imageApi: chatOnlyApi });
assert.equal(
  toolsChatOnly.some((t) => (t as { name?: string }).name === 'generate_image'),
  true,
  'prefs-on chat-only host must still register generate_image (execute errors)',
);

const toolsOff = buildTools(prefsOff, DEFAULT_SECURITY, undefined, { imageApi: imagesHostApi });
assert.equal(
  toolsOff.some((t) => (t as { name?: string }).name === 'generate_image'),
  false,
  'prefs-off must not register generate_image',
);

// Lockstep: whatever listEnabledToolIds says, buildTools agrees.
for (const [label, api] of [
  ['images-host', imagesHostApi],
  ['chat-only', chatOnlyApi],
] as const) {
  const listed = listEnabledToolIds(prefsOn).includes('generate_image');
  const built = buildTools(prefsOn, DEFAULT_SECURITY, undefined, { imageApi: api }).some(
    (t) => (t as { name?: string }).name === 'generate_image',
  );
  assert.equal(listed, built, `${label}: prompt list vs buildTools mismatch`);
  assert.equal(listed, true, `${label}: prefs-on must list generate_image`);
}

// Computer routing names generate_image when prefs enable it (capability irrelevant).
const route = {
  computers: [
    { id: 'local', name: '本机', host: '127.0.0.1', port: 1, token: 't' },
    { id: 'mini', name: 'Mac mini', host: '127.0.0.1', port: 2, token: 't' },
  ],
  defaultComputerId: 'local',
};
assert.equal(formatComputerRoutingSection(route).includes('generate_image'), false);
assert.equal(
  formatComputerRoutingSection(route, { mentionGenerateImage: true }).includes('generate_image'),
  true,
);
assert.equal(
  shellFsRoutingSection(route, prefsOn, { imageCapable: false }).includes('generate_image'),
  true,
);
assert.equal(
  shellFsRoutingSection(route, prefsOn, { imageCapable: true }).includes('generate_image'),
  true,
);
assert.equal(
  shellFsRoutingSection(route, prefsOff).includes('generate_image'),
  false,
);

console.log('generateImage.toolsGate.test.ts: ok');
