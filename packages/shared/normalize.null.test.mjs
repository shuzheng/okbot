import assert from 'node:assert/strict';
import {
  normalizeMaxTurns,
  normalizeToolRunMaxToolCalls,
  normalizeToolRunMaxDurationSec,
  normalizeSecuritySettings,
  normalizeContextCompression,
  normalizeMaxTokens,
  DEFAULT_MAX_TURNS,
  DEFAULT_TOOL_RUN,
  DEFAULT_DENIED_PATH_PREFIXES,
  DEFAULT_CONTEXT_COMPRESSION,
  DEFAULT_SQUAD_CAPTAIN_PERSONA,
  DEFAULT_SQUAD_PLAYBOOK,
  normalizeSquadSettings,
  normalizeLocalHttpApiSettings,
  sanitizeLocalHttpApiToken,
  normalizeComputerEntry,
  normalizeDefaultComputerId,
  LOCAL_COMPUTER_ID,
  normalizeInstructionsSettings,
  LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA,
  LEGACY_DEFAULT_SQUAD_PLAYBOOK,
  DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT,
  LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT,
  LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD,
  LEGACY_AGENTS_MD_REFRESH_WITH_ROBOT,
  normalizeMaintenanceSettings,
  normalizeMemorySettings,
  DEFAULT_MAINTENANCE_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
  normalizeWebSettings,
  isWebSearchConfigured,
  DEFAULT_WEB_SETTINGS,
} from './dist/index.js';

assert.equal(normalizeMaxTokens(null), null);
assert.equal(normalizeMaxTokens(''), null);

assert.equal(normalizeMaxTurns(null), DEFAULT_MAX_TURNS);
assert.equal(normalizeMaxTurns(''), DEFAULT_MAX_TURNS);
assert.equal(normalizeMaxTurns('  '), DEFAULT_MAX_TURNS);
assert.equal(normalizeMaxTurns(undefined), DEFAULT_MAX_TURNS);
assert.equal(normalizeMaxTurns(3), 3);

assert.equal(normalizeToolRunMaxToolCalls(null), DEFAULT_TOOL_RUN.maxToolCalls);
assert.equal(normalizeToolRunMaxToolCalls(''), DEFAULT_TOOL_RUN.maxToolCalls);
assert.equal(normalizeToolRunMaxToolCalls(0), 0);
assert.equal(normalizeToolRunMaxDurationSec(null), DEFAULT_TOOL_RUN.maxDurationSec);
assert.equal(normalizeToolRunMaxDurationSec(''), DEFAULT_TOOL_RUN.maxDurationSec);
assert.equal(normalizeToolRunMaxDurationSec(0), 0);

const sec = normalizeSecuritySettings({ deniedPathPrefixes: null });
assert.deepEqual(sec.deniedPathPrefixes, [...DEFAULT_DENIED_PATH_PREFIXES]);
const sec2 = normalizeSecuritySettings({ deniedPathPrefixes: [] });
assert.deepEqual(sec2.deniedPathPrefixes, []);

const cc = normalizeContextCompression(null);
assert.equal(cc.ratio, DEFAULT_CONTEXT_COMPRESSION.ratio);
assert.equal(cc.keepRecentMax, DEFAULT_CONTEXT_COMPRESSION.keepRecentMax);



assert.match(DEFAULT_SQUAD_CAPTAIN_PERSONA, /并行/);
assert.doesNotMatch(DEFAULT_SQUAD_CAPTAIN_PERSONA, /默认串行调用/);
assert.match(DEFAULT_SQUAD_PLAYBOOK, /并行调用/);
assert.doesNotMatch(DEFAULT_SQUAD_PLAYBOOK, /默认一次调用一名队员/);

{
  const upgraded = normalizeSquadSettings({
    captainPersona: LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA,
    playbook: LEGACY_DEFAULT_SQUAD_PLAYBOOK,
  });
  assert.equal(upgraded.captainPersona, DEFAULT_SQUAD_CAPTAIN_PERSONA);
  assert.equal(upgraded.playbook, DEFAULT_SQUAD_PLAYBOOK);
}

assert.doesNotMatch(DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT, /无图像处理能力/);
assert.doesNotMatch(DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT, /NO_CHANGE/);
{
  const a = normalizeInstructionsSettings({
    agentsMdRefreshSystemPrompt: LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT,
  });
  const b = normalizeInstructionsSettings({
    agentsMdRefreshSystemPrompt: LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD,
  });
  const c = normalizeInstructionsSettings({
    agentsMdRefreshSystemPrompt: LEGACY_AGENTS_MD_REFRESH_WITH_ROBOT,
  });
  assert.equal(a.agentsMdRefreshSystemPrompt, DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT);
  assert.equal(b.agentsMdRefreshSystemPrompt, DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT);
  assert.equal(c.agentsMdRefreshSystemPrompt, DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT);
  assert.doesNotMatch(DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT, /机器人/);
}


// null must not collapse to clamp floors (every-turn maintenance / tiny memory prompt).
{
  const m = normalizeMaintenanceSettings({
    memoryEveryTurns: null,
    agentsEveryTurns: null,
    skillsEveryUserChars: null,
  });
  assert.equal(m.memoryEveryTurns, DEFAULT_MAINTENANCE_SETTINGS.memoryEveryTurns);
  assert.equal(m.agentsEveryTurns, DEFAULT_MAINTENANCE_SETTINGS.agentsEveryTurns);
  assert.equal(m.skillsEveryUserChars, DEFAULT_MAINTENANCE_SETTINGS.skillsEveryUserChars);
}
{
  const mem = normalizeMemorySettings({ promptMaxEntries: null, promptMaxChars: null });
  assert.equal(mem.promptMaxEntries, DEFAULT_MEMORY_SETTINGS.promptMaxEntries);
  assert.equal(mem.promptMaxChars, DEFAULT_MEMORY_SETTINGS.promptMaxChars);
}

console.log('normalize.null.test.mjs: ok');

assert.equal(sanitizeLocalHttpApiToken('ab.cd e'), 'abcde');
const kept = normalizeLocalHttpApiSettings({ enabled: true, token: 'ab.cd' });
assert.equal(kept.token, 'abcd');
const disabledEmpty = normalizeLocalHttpApiSettings({ enabled: false, token: '' });
assert.equal(disabledEmpty.token, '');
const enabledEmpty = normalizeLocalHttpApiSettings({ enabled: true, token: '!!!' });
assert.equal(enabledEmpty.token, '');
const reused = normalizeLocalHttpApiSettings({ enabled: false, token: 'abc_DEF-123' });
assert.equal(reused.token, 'abc_DEF-123');

const keptComputer = normalizeComputerEntry({
  id: 'computer_a',
  name: 'A',
  host: '127.0.0.1',
  port: 18790,
  token: 'tok',
});
assert.equal(keptComputer && keptComputer.enabled, true);
const offComputer = normalizeComputerEntry({
  id: 'computer_b',
  name: 'B',
  host: '127.0.0.1',
  port: 18790,
  token: 'tok',
  enabled: false,
});
assert.equal(offComputer && offComputer.enabled, false);
assert.equal(
  normalizeDefaultComputerId('computer_b', [offComputer]),
  LOCAL_COMPUTER_ID,
);

const webEmpty = normalizeWebSettings(undefined);
assert.equal(webEmpty.search.provider, 'tavily');
assert.equal(webEmpty.search.apiKey, '');
assert.equal(webEmpty.fetch.allowPrivateNetwork, false);
assert.equal(isWebSearchConfigured(webEmpty.search), false);

const webOk = normalizeWebSettings({
  search: { provider: 'brave', apiKey: ' k ', baseURL: ' https://x.example/ ' },
  fetch: { allowPrivateNetwork: true },
});
assert.equal(webOk.search.provider, 'brave');
assert.equal(webOk.search.apiKey, ' k ');
assert.equal(webOk.search.baseURL, 'https://x.example/');
assert.equal(webOk.fetch.allowPrivateNetwork, true);
assert.equal(isWebSearchConfigured(webOk.search), true);

assert.equal(normalizeWebSettings({ search: { provider: 'nope' } }).search.provider, 'tavily');
assert.ok(DEFAULT_WEB_SETTINGS.search.provider);
console.log('normalizeWebSettings: ok');
