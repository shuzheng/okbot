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
assert.doesNotMatch(codeOnly, /pointer-events:\s*none/);
assert.doesNotMatch(codeOnly, /visibility:\s*hidden/);
assert.doesNotMatch(codeOnly, /z-index:\s*-1/);
assert.match(src, /image\/\*/);
assert.match(src, /input\.click\(\)/);
assert.match(src, /showPicker/);

console.log('browserPickFiles.test.ts: ok');
