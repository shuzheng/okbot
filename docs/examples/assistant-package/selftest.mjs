import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  buildAssistantPackage,
  assistantPackageToFileMap,
  parseAssistantPackage,
  stripSecrets,
} from '../../../packages/agent/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '_out');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const pkg = buildAssistantPackage({
  name: '自测助手',
  description: '人设：简洁、可复现的演示助手',
  avatar: { avatarKind: 'emoji', emoji: '📦', color: '#2563eb' },
  agentsMd: '# 自测\n你是包导入导出自测助手。',
  skills: [
    {
      slug: 'okbot-demo-pack',
      name: '打包演示',
      description: '演示导出与导入',
      body: '## When\n导出助手包\n\n## Steps\n1. 导出\n2. 导入验证',
    },
  ],
});

const dirty = stripSecrets({ ...pkg.manifest, apiKey: 'sk-leak', token: 't' });
if ('apiKey' in dirty || 'token' in dirty) {
  throw new Error('stripSecrets failed');
}

const files = assistantPackageToFileMap(pkg);
for (const [rel, body] of Object.entries(files)) {
  const abs = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

const round = parseAssistantPackage({
  manifest: JSON.parse(files['manifest.json']),
  agentsMd: files['AGENTS.md'],
  skillFiles: [
    {
      slug: 'okbot-demo-pack',
      raw: files['skills/okbot-demo-pack/SKILL.md'],
    },
  ],
});
if (round.manifest.name !== '自测助手') throw new Error('name mismatch');
if (round.skills.length !== 1) throw new Error('skills mismatch');

const evidence = {
  ok: true,
  outDir,
  files: Object.keys(files),
  strippedSecretKeys: true,
  at: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
