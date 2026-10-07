import assert from 'node:assert/strict';
import { resolveToolApproval, resolveAutoApproval, isMcpToolName } from './dist/index.js';

const allowShell = [{ id: 'a', description: 'run_shell', action: 'allow', createdAt: '', updatedAt: '' }];
const on = { autoApprovalEnabled: true, autoApprovalRules: allowShell };

assert.equal(isMcpToolName('mcp_fs_run_shell'), true);
assert.equal(isMcpToolName('run_shell'), false);
// Built-in allow rule still allows the built-in tool.
assert.equal(resolveToolApproval(on, 'run_shell', { command: 'ls' }), 'allow');
// It must not leak to an MCP tool with a similar name.
assert.equal(resolveToolApproval(on, 'mcp_fs_run_shell', { command: 'ls' }), 'ask');
// MCP always asks, even with a rule that names it.
const allowMcp = [{ id: 'b', description: 'mcp_fs_read', action: 'allow', createdAt: '', updatedAt: '' }];
assert.equal(resolveToolApproval({ autoApprovalEnabled: true, autoApprovalRules: allowMcp }, 'mcp_fs_read', {}), 'ask');
// Tool-name rules match the tool name, not the arguments.
assert.equal(resolveAutoApproval(true, allowShell, 'write_file', { content: 'run_shell' }), 'ask');
// Keyword rules keep substring behavior.
const kw = [{ id: 'c', description: 'git status', action: 'allow', createdAt: '', updatedAt: '' }];
assert.equal(resolveAutoApproval(true, kw, 'run_shell', { command: 'git status' }), 'allow');

// manage_schedule create/delete must never be AAR-auto-allowed.
const allowSched = [{ id: 'd', description: 'manage_schedule', action: 'allow', createdAt: '', updatedAt: '' }];
const schedOn = { autoApprovalEnabled: true, autoApprovalRules: allowSched };
assert.equal(resolveToolApproval(schedOn, 'manage_schedule', { action: 'create', prompt: 'x' }), 'ask');
assert.equal(resolveToolApproval(schedOn, 'manage_schedule', { action: 'delete', job_id: 'j1' }), 'ask');
assert.equal(resolveToolApproval(schedOn, 'manage_schedule', { action: 'list' }), 'allow');
assert.equal(resolveToolApproval(schedOn, 'manage_schedule', { action: 'pause', job_id: 'j1' }), 'allow');

console.log('approval.test.mjs: ok');
