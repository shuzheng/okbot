import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'browserPickFiles.ts'), 'utf8');
const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

assert.match(src, /input\.type = 'file'/);
assert.match(src, /input\.multiple = true/);
assert.match(codeOnly, /opacity:0/);
assert.match(src, /input\.style\.cssText/);
assert.doesNotMatch(codeOnly, /display:\s*none/);
assert.match(src, /image\/\*/);
assert.match(src, /input\.click\(\)/);

console.log('browserPickFiles.test.ts: ok');
