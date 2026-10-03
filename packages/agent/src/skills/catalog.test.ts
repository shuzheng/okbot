import assert from 'node:assert/strict';
import {
  buildSkillCatalogEntries,
  formatSkillCatalog,
} from './catalog.js';
import { parseSkillMarkdown, formatSkillMarkdown } from './parse.js';
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
const parsed = parseSkillMarkdown('okbot-demo-pack', md);
assert.equal(parsed.name, '打包演示');
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

const sseGate = { seenUserMessage: false };
const steeredDone: RuntimeEvent = {
  type: 'done',
  botId: 'bot_1',
  messageId: 'old',
  content: '',
  aborted: true,
};
assert.equal(acceptRuntimeEventForSseTurn(sseGate, steeredDone), false, 'ignore previous steer done');
assert.equal(sseGate.seenUserMessage, false);
const userEv: RuntimeEvent = {
  type: 'user_message',
  botId: 'bot_1',
  message: { id: 'u2', role: 'user', content: 'next', createdAt: '2026-01-01T00:00:00.000Z' },
};
assert.equal(acceptRuntimeEventForSseTurn(sseGate, userEv), true);
assert.equal(sseGate.seenUserMessage, true);
const thisDone: RuntimeEvent = { type: 'done', botId: 'bot_1', messageId: 'm2', content: 'ok' };
assert.equal(acceptRuntimeEventForSseTurn(sseGate, thisDone), true);

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
