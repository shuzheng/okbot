import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveGatewayUiRoot } from './gatewayRuntime';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-ui-root-'));
const chunkDir = path.join(root, 'out', 'main', 'chunks');
const mainDir = path.join(root, 'out', 'main');
const renderer = path.join(root, 'out', 'renderer');
fs.mkdirSync(chunkDir, { recursive: true });
fs.mkdirSync(renderer, { recursive: true });
fs.writeFileSync(path.join(renderer, 'index.html'), '<!doctype html>');

assert.equal(path.resolve(resolveGatewayUiRoot(chunkDir)), path.resolve(renderer));
assert.equal(path.resolve(resolveGatewayUiRoot(mainDir)), path.resolve(renderer));

fs.rmSync(root, { recursive: true, force: true });
console.log('gatewayRuntime.test.ts: ok');
