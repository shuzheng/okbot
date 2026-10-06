import assert from 'node:assert/strict';
import { isMcpToolName } from '@okbot/shared';
import { callMcpTool, formatMcpToolOutput, mcpServerTag, mcpToolName, stdioEnv } from './mcpHub.ts';
import { isInsecureRemoteMcpUrl } from '@okbot/shared';

const used = new Set<string>(['run_shell']);
const tagA = mcpServerTag('srv_a');
const tagB = mcpServerTag('srv_b');
assert.notEqual(tagA, tagB);
// Same display name, different servers: distinct names that do not depend on order.
const a1 = mcpToolName('File System', 'read-file', used, 'srv_a');
const b1 = mcpToolName('File System', 'read-file', used, 'srv_b');
assert.equal(a1, `mcp_file_system_${tagA}_read-file`);
assert.equal(b1, `mcp_file_system_${tagB}_read-file`);
const reversed = new Set<string>();
assert.equal(mcpToolName('File System', 'read-file', reversed, 'srv_b'), b1);
assert.equal(mcpToolName('File System', 'read-file', reversed, 'srv_a'), a1);
assert.ok(isMcpToolName(a1));
// The host environment is not passed through wholesale.
process.env.OKBOT_TEST_SECRET = 'x';
const env = stdioEnv({ EXTRA: '1' });
assert.equal(env.OKBOT_TEST_SECRET, undefined);
assert.equal(env.EXTRA, '1');
assert.equal(env.PATH, process.env.PATH);
const long = mcpToolName('x'.repeat(80), 'y'.repeat(80), used);
assert.ok(long.length <= 64);
assert.equal(formatMcpToolOutput([{ type: 'text', text: 'hi' }, { type: 'image', data: 'x' }]), 'hi\n{"type":"image","data":"x"}');
assert.equal(formatMcpToolOutput([]), '（MCP 工具没有返回内容）');
// isError results are tool errors.
const errServer = {
  callTool: async () => [],
  callToolResult: async () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }),
};
assert.equal(await callMcpTool(errServer as never, 't', {}), 'MCP 工具返回错误：boom');
const okServer = { callTool: async () => [{ type: 'text', text: 'fine' }] };
assert.equal(await callMcpTool(okServer as never, 't', {}), 'fine');

// Strict loopback: names that start with 127. are not loopback.
assert.equal(isInsecureRemoteMcpUrl('http://127.evil.com/mcp'), true);
assert.equal(isInsecureRemoteMcpUrl('http://localhost.evil.com/mcp'), true);
assert.equal(isInsecureRemoteMcpUrl('http://127.0.0.1:3000/mcp'), false);
assert.equal(isInsecureRemoteMcpUrl('http://127.1/mcp'), false);
assert.equal(isInsecureRemoteMcpUrl('http://[::1]:3000/mcp'), false);
assert.equal(isInsecureRemoteMcpUrl('http://localhost/mcp'), false);
assert.equal(isInsecureRemoteMcpUrl('http://10.0.0.2/mcp'), true);
assert.equal(isInsecureRemoteMcpUrl('https://example.com/mcp'), false);

console.log('mcpHub.test.ts: ok');
