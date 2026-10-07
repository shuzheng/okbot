import assert from 'node:assert/strict';
import {
  buildSkillCatalogEntries,
  formatSkillCatalog,
} from './catalog.js';
import { parseSkillMarkdown, formatSkillMarkdown, normalizeSkillSlug } from './parse.js';
import {
  buildAssistantPackage,
  parseAssistantPackage,
  stripSecrets,
  assistantPackageToFileMap,
  OKBOT_ASSISTANT_PACKAGE_FORMAT,
} from '../assistantPackage.js';
import {
  encodeRuntimeEventSse,
  parseRuntimeEventSseBlocks,
  isRuntimeEventTurnTerminal,
  acceptRuntimeEventForSseTurn,
} from '../runtime/events.js';
import {
  encodeExecStreamSse,
  parseExecStreamSseBlocks,
  foldExecStreamToFormatted,
} from '../runtime/execStream.js';
import type { RuntimeEvent } from '@okbot/shared';

// --- progressive skill catalog ---
const catalog = formatSkillCatalog(
  buildSkillCatalogEntries({
    local: [
      {
        slug: 'okbot-demo-pack',
        name: '打包演示',
        description: '导出助手包时使用',
        body: '## Steps\n1. 导出',
      },
    ],
    global: [
      {
        slug: 'okbot-global-greet',
        name: '全局问候',
        description: '寒暄',
        body: 'hello',
      },
    ],
    useGlobalSkills: true,
    enabledGlobalSkills: ['okbot-global-greet'],
  }),
);
assert.match(catalog, /打包演示/);
assert.match(catalog, /okbot-demo-pack/);
assert.match(catalog, /何时使用：导出助手包时使用/);
assert.match(catalog, /全局技能/);
assert.doesNotMatch(catalog, /## Steps/);
assert.doesNotMatch(catalog, /导出助手包时使用[\s\S]*## Steps/);

const md = formatSkillMarkdown({
  slug: 'okbot-demo-pack',
  name: '打包演示',
  description: '导出助手包时使用',
  body: '## Steps\n1. 导出',
});
assert.match(md, /name: "okbot-打包演示"/);
const parsed = parseSkillMarkdown('okbot-demo-pack', md);
assert.equal(parsed.name, 'okbot-打包演示');
assert.equal(parsed.description, '导出助手包时使用');
assert.match(parsed.body, /Steps/);

// --- assistant package strip secrets ---
const dirty = {
  name: 'x',
  apiKey: 'sk-secret',
  nested: { token: 't', keep: 1 },
  list: [{ password: 'p', ok: true }],
};
const cleaned = stripSecrets(dirty);
assert.equal('apiKey' in cleaned, false);
assert.equal('token' in (cleaned as { nested: object }).nested, false);
assert.equal((cleaned as { nested: { keep: number } }).nested.keep, 1);

const pkg = buildAssistantPackage({
  name: '演示助手',
  description: '人设：耐心的工程师',
  avatar: { avatarKind: 'emoji', emoji: '🧪', color: '#336699' },
  agentsMd: '# 人设\n你是演示助手。',
  skills: [parsed],
});
assert.equal(pkg.manifest.format, OKBOT_ASSISTANT_PACKAGE_FORMAT);
assert.equal(pkg.manifest.name, '演示助手');
const files = assistantPackageToFileMap(pkg);
assert.ok(files['manifest.json']);
assert.ok(files['AGENTS.md']);
assert.ok(files['skills/okbot-demo-pack/SKILL.md']);
assert.doesNotMatch(files['manifest.json']!, /sk-secret|apiKey/);

const roundtrip = parseAssistantPackage({
  manifest: JSON.parse(files['manifest.json']!),
  agentsMd: files['AGENTS.md'],
  skillFiles: [
    { slug: 'okbot-demo-pack', raw: files['skills/okbot-demo-pack/SKILL.md']! },
  ],
});
assert.equal(roundtrip.skills.length, 1);
assert.equal(roundtrip.skills[0]!.slug, 'okbot-demo-pack');

// --- RuntimeEvent SSE codec ---
const ev: RuntimeEvent = {
  type: 'delta',
  botId: 'bot_1',
  messageId: 'm1',
  delta: '你好',
};
const frame = encodeRuntimeEventSse(ev);
assert.match(frame, /event: delta/);
assert.match(frame, /你好/);
const { events, rest } = parseRuntimeEventSseBlocks(frame + 'partial');
assert.equal(events.length, 1);
assert.equal(events[0]!.type, 'delta');
assert.equal(rest, 'partial');
assert.equal(isRuntimeEventTurnTerminal({ type: 'done', botId: 'b', messageId: 'm', content: '' }), true);
assert.equal(isRuntimeEventTurnTerminal(ev), false);

const sseGate = { runId: null as string | null };
const steeredDone: RuntimeEvent = {
  type: 'done',
  botId: 'bot_1',
  messageId: 'old',
  content: '',
  aborted: true,
  runId: 'run_other',
};
assert.equal(acceptRuntimeEventForSseTurn(sseGate, steeredDone), false, 'ignore events before this turn binds');
assert.equal(sseGate.runId, null);
const started: RuntimeEvent = {
  type: 'turn_started',
  botId: 'bot_1',
  runId: 'run_2',
  userMessageId: 'u2',
  assistantMessageId: 'm2',
};
assert.equal(acceptRuntimeEventForSseTurn(sseGate, started), true);
assert.equal(sseGate.runId, 'run_2');
const siblingDelta: RuntimeEvent = {
  type: 'delta',
  botId: 'bot_1',
  messageId: 'm_other',
  delta: 'x',
  runId: 'run_other',
};
assert.equal(acceptRuntimeEventForSseTurn(sseGate, siblingDelta), false, 'ignore sibling run deltas');
const thisDone: RuntimeEvent = { type: 'done', botId: 'bot_1', messageId: 'm2', content: 'ok', runId: 'run_2' };
assert.equal(acceptRuntimeEventForSseTurn(sseGate, thisDone), true);

const gated = { runId: null as string | null, clientTurnId: 'local_1' };
assert.equal(
  acceptRuntimeEventForSseTurn(gated, {
    type: 'turn_started',
    botId: 'bot_1',
    runId: 'run_a',
    userMessageId: 'u_a',
    assistantMessageId: 'm_a',
    clientTurnId: 'local_other',
  }),
  false,
  'clientTurnId mismatch',
);
assert.equal(
  acceptRuntimeEventForSseTurn(gated, {
    type: 'turn_started',
    botId: 'bot_1',
    runId: 'run_b',
    userMessageId: 'u_b',
    assistantMessageId: 'm_b',
    clientTurnId: 'local_1',
  }),
  true,
);
assert.equal(gated.runId, 'run_b');

{
  const toolReqNoRun: RuntimeEvent = {
    type: 'tool_request',
    botId: 'bot_1',
    messageId: 'm_b',
    requestId: 'req_1',
    toolName: 'run_shell',
    arguments: { command: 'echo' },
  };
  assert.equal(
    acceptRuntimeEventForSseTurn(gated, toolReqNoRun),
    false,
    'tool_request without runId must not reach gateway/attach SSE',
  );
  const toolReq: RuntimeEvent = {
    ...toolReqNoRun,
    runId: 'run_b',
  };
  assert.equal(acceptRuntimeEventForSseTurn(gated, toolReq), true);
}

const skillsChanged: RuntimeEvent = {
  type: 'skills_changed',
  botId: 'bot_1',
  at: new Date().toISOString(),
};
assert.match(encodeRuntimeEventSse(skillsChanged), /skills_changed/);

// --- ExecStream SSE (cloud adapter alignment) ---
const sse =
  encodeExecStreamSse({ type: 'stdout', chunk: 'hi\n' }) +
  encodeExecStreamSse({
    type: 'done',
    formatted: 'cwd: /tmp\n\nstdout:\nhi\n',
    exitCode: 0,
  });
const execParsed = parseExecStreamSseBlocks(sse);
assert.equal(execParsed.events.length, 2);
assert.equal(foldExecStreamToFormatted(execParsed.events)?.includes('hi'), true);

console.log('skills/catalog + package + runtime event tests ok');

// --- normalizeSkillSlug: bare and prefixed collapse to one canonical slug ---
assert.equal(normalizeSkillSlug('demo-pack'), 'okbot-demo-pack');
assert.equal(normalizeSkillSlug('okbot-demo-pack'), 'okbot-demo-pack');
assert.equal(normalizeSkillSlug('OKBOT-Demo-Pack'), 'okbot-demo-pack');
assert.equal(normalizeSkillSlug('  demo pack!! '), 'okbot-demo-pack');
assert.equal(normalizeSkillSlug(''), '');

// formatSkillMarkdown prefixes bare input (name + implied slug canonicalization)
const bareMd = formatSkillMarkdown({
  slug: 'demo-pack',
  name: '打包演示',
  description: '导出',
  body: 'steps',
});
assert.match(bareMd, /name: "okbot-打包演示"/);
assert.equal(normalizeSkillSlug('demo-pack'), normalizeSkillSlug('okbot-demo-pack'));
