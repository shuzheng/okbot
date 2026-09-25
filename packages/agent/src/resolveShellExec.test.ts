import assert from 'node:assert/strict';
import { resolveShellExec } from './tools.js';

{
  const spec = resolveShellExec(
    'echo hi',
    'win32',
    { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    { findExecutable: (name) => (name === 'pwsh' ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' : null) },
  );
  assert.equal(spec.file, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe');
  assert.deepEqual(spec.args, ['-NoProfile', '-NonInteractive', '-Command', 'echo hi']);
}

{
  const spec = resolveShellExec(
    'dir',
    'win32',
    { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    { findExecutable: () => null },
  );
  assert.equal(spec.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(spec.args, ['/d', '/s', '/c', 'dir']);
}

{
  const spec = resolveShellExec('dir', 'win32', {}, { findExecutable: () => null });
  assert.equal(spec.file, 'cmd.exe');
  assert.deepEqual(spec.args, ['/d', '/s', '/c', 'dir']);
}

{
  const spec = resolveShellExec('ls', 'darwin', { SHELL: '/bin/zsh' });
  assert.equal(spec.file, '/bin/zsh');
  assert.deepEqual(spec.args, ['-lc', 'ls']);
}

{
  const spec = resolveShellExec('ls', 'darwin', {});
  assert.equal(spec.file, '/bin/zsh');
  assert.deepEqual(spec.args, ['-lc', 'ls']);
}

{
  const spec = resolveShellExec('ls', 'linux', {});
  assert.equal(spec.file, '/bin/bash');
  assert.deepEqual(spec.args, ['-lc', 'ls']);
}

{
  const spec = resolveShellExec('pwd', 'linux', { SHELL: '/usr/bin/fish' });
  assert.equal(spec.file, '/usr/bin/fish');
  assert.deepEqual(spec.args, ['-lc', 'pwd']);
}

console.log('resolveShellExec.test.ts: ok');
