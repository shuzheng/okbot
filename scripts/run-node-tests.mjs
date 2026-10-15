#!/usr/bin/env node
/**
 * Discover and run package tests (*.test.ts / *.test.mjs).
 * Usage: node scripts/run-node-tests.mjs [--root <dir>] [--import tsx] [glob...]
 * Default globs match any nested .test.ts / .test.mjs under --root (cwd by default).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let root = process.cwd();
let loader = null;
const patterns = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--root') {
    root = path.resolve(args[++i]);
  } else if (a === '--import') {
    loader = args[++i];
  } else if (a.startsWith('-')) {
    console.error(`Unknown flag: ${a}`);
    process.exit(2);
  } else {
    patterns.push(a);
  }
}

if (patterns.length === 0) {
  patterns.push('**/*.test.ts', '**/*.test.mjs');
}

const ignoreDir = new Set(['node_modules', 'dist', 'out', '.git', 'coverage']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ignoreDir.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function matchGlob(rel, pattern) {
  const norm = rel.split(path.sep).join('/');
  if (pattern === '**/*.test.ts' || pattern.endsWith('*.test.ts')) {
    if (pattern === '*.test.ts') return /^[^/]+\.test\.ts$/.test(norm);
    return norm.endsWith('.test.ts');
  }
  if (pattern === '**/*.test.mjs' || pattern.endsWith('*.test.mjs')) {
    if (pattern === '*.test.mjs') return /^[^/]+\.test\.mjs$/.test(norm);
    return norm.endsWith('.test.mjs');
  }
  return norm === pattern;
}

const files = walk(root)
  .map((f) => path.relative(root, f))
  .filter((rel) => patterns.some((p) => matchGlob(rel, p)))
  .sort();

if (files.length === 0) {
  console.error(`No tests matched under ${root} for ${patterns.join(', ')}`);
  process.exit(1);
}

console.log(`Running ${files.length} test file(s) in ${path.basename(root)}…`);
let failed = 0;
for (const rel of files) {
  const abs = path.join(root, rel);
  const nodeArgs = [];
  if (loader) nodeArgs.push('--import', loader);
  nodeArgs.push(abs);
  const r = spawnSync(process.execPath, nodeArgs, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    failed += 1;
    console.error(`FAIL ${rel} (exit ${r.status ?? 'null'})`);
  }
}
if (failed) {
  console.error(`${failed}/${files.length} test file(s) failed`);
  process.exit(1);
}
console.log(`All ${files.length} test file(s) passed`);
