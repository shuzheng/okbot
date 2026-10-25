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

// Gateway CLI layout: apps/gateway/dist|src → apps/desktop/out/renderer
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-ui-root-repo-'));
const gatewayDist = path.join(repo, 'apps', 'gateway', 'dist');
const gatewaySrc = path.join(repo, 'apps', 'gateway', 'src');
const desktopRenderer = path.join(repo, 'apps', 'desktop', 'out', 'renderer');
fs.mkdirSync(gatewayDist, { recursive: true });
fs.mkdirSync(gatewaySrc, { recursive: true });
fs.mkdirSync(desktopRenderer, { recursive: true });
fs.writeFileSync(path.join(desktopRenderer, 'index.html'), '<!doctype html>');
assert.equal(path.resolve(resolveGatewayUiRoot(gatewayDist)), path.resolve(desktopRenderer));
assert.equal(path.resolve(resolveGatewayUiRoot(gatewaySrc)), path.resolve(desktopRenderer));

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(repo, { recursive: true, force: true });
console.log('gatewayRuntime.test.ts: ok');
