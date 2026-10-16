import assert from 'node:assert/strict';
import {
  normalizeMaxTurns,
  normalizeSecuritySettings,
  normalizeContextCompression,
  normalizeMaxTokens,
  DEFAULT_MAX_TURNS,
  DEFAULT_DENIED_PATH_PREFIXES,
  DEFAULT_DANGEROUS_SHELL_PATTERNS,
  resolveShellPatterns,
  tryCompileShellPattern,
  DEFAULT_CONTEXT_COMPRESSION,
  DEFAULT_SQUAD_CAPTAIN_PERSONA,
  DEFAULT_SQUAD_PLAYBOOK,
  normalizeSquadSettings,
  normalizeLocalHttpApiSettings,
  sanitizeLocalHttpApiToken,
  normalizeComputerEntry,
  normalizeDefaultComputerId,
  normalizePinnedOwnerIds,
  normalizeHiddenOwnerIds,
  normalizeOwnerGroups,
  normalizeOwnerGroupMembership,
  normalizeOwnerGroupOrder,
  UNGROUPED_OWNER_GROUP_ID,
  DEFAULT_NEW_OWNER_GROUP_NAME,
  allocateUniqueOwnerGroupName,
  normalizeDefaultAssistantId,
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


const sec = normalizeSecuritySettings({ deniedPathPrefixes: null });
assert.deepEqual(sec.deniedPathPrefixes, [...DEFAULT_DENIED_PATH_PREFIXES]);
const sec2 = normalizeSecuritySettings({ deniedPathPrefixes: [] });
assert.deepEqual(sec2.deniedPathPrefixes, []);

assert.equal(normalizeSecuritySettings({}).shellPatterns, undefined);
assert.deepEqual(normalizeSecuritySettings({ shellPatterns: [] }).shellPatterns, []);
const secPat = normalizeSecuritySettings({
  shellPatterns: [{ id: 'x', pattern: 'foo', label: 'Foo' }, { id: 'y', pattern: '  ' }],
});
assert.deepEqual(secPat.shellPatterns, [{ id: 'x', pattern: 'foo', label: 'Foo' }]);
assert.equal(resolveShellPatterns(normalizeSecuritySettings({})).length, DEFAULT_DANGEROUS_SHELL_PATTERNS.length);
assert.equal(resolveShellPatterns(normalizeSecuritySettings({ shellPatterns: [] })).length, 0);
// Non-empty malformed raw must NOT fail-open to an empty denylist.
{
  const badEmptyObj = normalizeSecuritySettings({ shellPatterns: [{}] });
  assert.equal(badEmptyObj.shellPatterns, undefined);
  assert.equal(
    resolveShellPatterns(badEmptyObj).length,
    DEFAULT_DANGEROUS_SHELL_PATTERNS.length,
  );
  const badWrongKey = normalizeSecuritySettings({ shellPatterns: [{ re: 'x' }] });
  assert.equal(badWrongKey.shellPatterns, undefined);
  assert.equal(
    resolveShellPatterns(badWrongKey).length,
    DEFAULT_DANGEROUS_SHELL_PATTERNS.length,
  );
  const allBlank = normalizeSecuritySettings({
    shellPatterns: [{ id: 'a', pattern: '  ' }, { id: 'b' }],
  });
  assert.equal(allBlank.shellPatterns, undefined);
  // Invalid-only (uncompilable) → treat like 0 valid → defaults.
  const onlyBad = normalizeSecuritySettings({
    shellPatterns: [{ id: 'bad', pattern: '(unclosed', label: 'bad' }],
  });
  assert.equal(onlyBad.shellPatterns, undefined);
  assert.equal(
    resolveShellPatterns(onlyBad).length,
    DEFAULT_DANGEROUS_SHELL_PATTERNS.length,
  );
}
assert.ok(tryCompileShellPattern(String.raw`\bsudo\b`));
assert.equal(tryCompileShellPattern('(unclosed'), null);

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
assert.equal(webEmpty.search.compat, 'tavily');
assert.equal(webEmpty.fetch.allowPrivateNetwork, false);
assert.equal(isWebSearchConfigured(webEmpty.search), false);

const webOk = normalizeWebSettings({
  search: { provider: 'brave', apiKey: ' k ', baseURL: ' https://x.example/ ' },
  fetch: { allowPrivateNetwork: true },
});
assert.equal(webOk.search.provider, 'brave');
assert.equal(webOk.search.apiKey, ' k ');
assert.equal(webOk.search.baseURL, 'https://x.example/');
assert.equal(webOk.search.compat, 'tavily');
assert.equal(webOk.fetch.allowPrivateNetwork, true);
assert.equal(isWebSearchConfigured(webOk.search), true);

const webCustom = normalizeWebSettings({
  search: { provider: 'custom', apiKey: 'ck', baseURL: ' https://proxy.example ', compat: 'serper' },
});
assert.equal(webCustom.search.provider, 'custom');
assert.equal(webCustom.search.compat, 'serper');
assert.equal(webCustom.search.baseURL, 'https://proxy.example');
assert.equal(isWebSearchConfigured(webCustom.search), true);
assert.equal(
  isWebSearchConfigured({ provider: 'custom', apiKey: 'ck', baseURL: '', compat: 'tavily' }),
  false,
);

assert.equal(normalizeWebSettings({ search: { provider: 'nope' } }).search.provider, 'tavily');
assert.ok(DEFAULT_WEB_SETTINGS.search.provider);
console.log('normalizeWebSettings: ok');

assert.deepEqual(normalizePinnedOwnerIds(null), []);
assert.deepEqual(normalizePinnedOwnerIds(undefined), []);
assert.deepEqual(normalizePinnedOwnerIds('x'), []);
assert.deepEqual(normalizePinnedOwnerIds([' a ', 'a', '', 1, 'b']), ['a', 'b']);
assert.deepEqual(
  normalizePinnedOwnerIds(['a', 'b', 'c'], ['b', 'c']),
  ['b', 'c'],
);
assert.equal(normalizeDefaultAssistantId(null), '');
assert.equal(normalizeDefaultAssistantId('  bot_1  ', [{ id: 'bot_1' }]), 'bot_1');
assert.equal(normalizeDefaultAssistantId('bot_x', [{ id: 'bot_1' }]), '');
console.log('normalizePinnedOwnerIds ok');

assert.deepEqual(normalizeHiddenOwnerIds(null), []);
assert.deepEqual(normalizeHiddenOwnerIds([' a ', 'a', '', 1, 'b']), ['a', 'b']);
assert.deepEqual(
  normalizeHiddenOwnerIds(['a', 'b', 'c'], ['b', 'c']),
  ['b', 'c'],
);
console.log('normalizeHiddenOwnerIds ok');

assert.deepEqual(normalizeOwnerGroups(null), []);
assert.deepEqual(normalizeOwnerGroups(undefined), []);
assert.deepEqual(normalizeOwnerGroups('x'), []);
assert.deepEqual(
  normalizeOwnerGroups([
    { id: ' g1 ', name: ' Work ' },
    { id: 'g1', name: 'dup' },
    { id: UNGROUPED_OWNER_GROUP_ID, name: 'nope' },
    { id: '', name: 'x' },
    { id: 'g2', name: '  ' },
    null,
    1,
  ]),
  [
    { id: 'g1', name: 'Work' },
    { id: 'g2', name: DEFAULT_NEW_OWNER_GROUP_NAME },
  ],
);
console.log('normalizeOwnerGroups ok');

assert.equal(allocateUniqueOwnerGroupName([]), DEFAULT_NEW_OWNER_GROUP_NAME);
assert.equal(
  allocateUniqueOwnerGroupName([{ id: 'a', name: 'Work' }]),
  DEFAULT_NEW_OWNER_GROUP_NAME,
);
assert.equal(
  allocateUniqueOwnerGroupName([{ id: 'a', name: DEFAULT_NEW_OWNER_GROUP_NAME }]),
  `${DEFAULT_NEW_OWNER_GROUP_NAME}1`,
);
assert.equal(
  allocateUniqueOwnerGroupName([
    { id: 'a', name: DEFAULT_NEW_OWNER_GROUP_NAME },
    { id: 'b', name: `${DEFAULT_NEW_OWNER_GROUP_NAME}1` },
  ]),
  `${DEFAULT_NEW_OWNER_GROUP_NAME}2`,
);
assert.equal(
  allocateUniqueOwnerGroupName([
    DEFAULT_NEW_OWNER_GROUP_NAME,
    `${DEFAULT_NEW_OWNER_GROUP_NAME}1`,
    `${DEFAULT_NEW_OWNER_GROUP_NAME}3`,
  ]),
  `${DEFAULT_NEW_OWNER_GROUP_NAME}2`,
);
assert.equal(
  allocateUniqueOwnerGroupName([{ id: 'a', name: ' New group ' }], 'New group'),
  'New group1',
);
console.log('allocateUniqueOwnerGroupName ok');

assert.deepEqual(normalizeOwnerGroupMembership(null), {});
assert.deepEqual(normalizeOwnerGroupMembership(undefined), {});
assert.deepEqual(normalizeOwnerGroupMembership([]), {});
const groups = [{ id: 'g1', name: 'A' }, { id: 'g2', name: 'B' }];
assert.deepEqual(
  normalizeOwnerGroupMembership(
    {
      a: 'g1',
      b: 'missing',
      c: UNGROUPED_OWNER_GROUP_ID,
      d: null,
      e: 'g2',
      '': 'g1',
      f: '  g1  ',
    },
    groups,
    ['a', 'b', 'e', 'f'],
  ),
  { a: 'g1', e: 'g2', f: 'g1' },
);
console.log('normalizeOwnerGroupMembership ok');

const orderGroups = [{ id: 'g1', name: 'A' }, { id: 'g2', name: 'B' }];
assert.deepEqual(normalizeOwnerGroupOrder(null, orderGroups), [
  'g1',
  'g2',
  UNGROUPED_OWNER_GROUP_ID,
]);
assert.deepEqual(
  normalizeOwnerGroupOrder(
    [UNGROUPED_OWNER_GROUP_ID, 'g2', 'missing', 'g1', 'g2'],
    orderGroups,
  ),
  [UNGROUPED_OWNER_GROUP_ID, 'g2', 'g1'],
);
assert.deepEqual(
  normalizeOwnerGroupOrder(['g1'], orderGroups),
  ['g1', 'g2', UNGROUPED_OWNER_GROUP_ID],
);
console.log('normalizeOwnerGroupOrder ok');
