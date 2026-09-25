/**
 * Generated instruction-like model outputs must drop `<think>` before persist.
 * Mirrors the strip applied in refreshAgentsMd / refreshBotSkills / refreshMemories /
 * compressSessionHistory (and FileStorage writeAgentsMd / writeSkill / memory / summary).
 */
import assert from 'node:assert/strict';
import { stripThinkContent } from '@okbot/shared';

const COT = '<think>内部推理：应写入角色与步骤</think>';

// AGENTS.md style full rewrite
const agentsRaw = `${COT}\n\n# 角色与目标\n你是打包助手，负责导出指令。\n`;
const agents = stripThinkContent(agentsRaw).trim();
assert(!agents.includes('<think>'), 'AGENTS output strips open tag');
assert(!agents.includes('内部推理'), 'AGENTS output strips thinking body');
assert(agents.includes('# 角色与目标'), 'AGENTS keeps instruction body');
assert(agents.includes('打包助手'), 'AGENTS keeps visible answer');

// Skill / memory JSON wrapped in CoT
const jsonRaw = `${COT}\n{"action":"upsert","skill":{"slug":"pack","name":"打包","description":"导出","body":"${COT}\\n## Steps\\n1. 导出"}}`;
const jsonStripped = stripThinkContent(jsonRaw).trim();
assert(!jsonStripped.startsWith('<think>'), 'JSON wrapper CoT removed');
const parsed = JSON.parse(jsonStripped) as {
  action: string;
  skill: { body: string; name: string };
};
assert.equal(parsed.action, 'upsert');
const body = stripThinkContent(parsed.skill.body).trim();
assert(!body.includes('<think>'), 'skill body CoT removed');
assert(body.includes('## Steps'), 'skill body keeps steps');

console.log('refresh.stripOutput.test.ts: ok');
