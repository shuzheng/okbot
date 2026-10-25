import assert from 'node:assert/strict';
import { isKnownCommand, maskToken, parseArgv, parseBool, parsePort } from './parse';

assert.equal(isKnownCommand('serve'), true);
assert.equal(isKnownCommand('nope'), false);

{
  const p = parseArgv([]);
  assert.equal(p.command, null);
  assert.equal(p.help, false);
  assert.equal(p.version, false);
}

{
  const p = parseArgv(['--help']);
  assert.equal(p.help, true);
  assert.equal(p.command, null);
}

{
  const p = parseArgv(['-h']);
  assert.equal(p.help, true);
}

{
  const p = parseArgv(['--version']);
  assert.equal(p.version, true);
  assert.equal(p.command, null);
}

{
  const p = parseArgv(['-V']);
  assert.equal(p.version, true);
}

{
  const p = parseArgv(['serve']);
  assert.equal(p.command, 'serve');
  assert.deepEqual(p.args, []);
}

{
  const p = parseArgv(['serve', '--help']);
  assert.equal(p.command, 'serve');
  assert.equal(p.help, true);
}

{
  const p = parseArgv(['--lang', 'en', 'status']);
  assert.equal(p.lang, 'en');
  assert.equal(p.command, 'status');
}

{
  const p = parseArgv(['status', '--lang', 'zh']);
  assert.equal(p.lang, 'zh');
  assert.equal(p.command, 'status');
}

{
  const p = parseArgv(['--lang=en', 'config', 'set', '--port', '19000']);
  assert.equal(p.lang, 'en');
  assert.equal(p.command, 'config');
  assert.deepEqual(p.args, ['set', '--port', '19000']);
}

{
  const p = parseArgv(['--lang', 'fr', 'help']);
  assert.equal(p.error, 'invalid_lang');
}

{
  const p = parseArgv(['version']);
  assert.equal(p.command, 'version');
}

assert.equal(parseBool('true'), true);
assert.equal(parseBool('FALSE'), false);
assert.equal(parseBool('yes'), true);
assert.equal(parseBool('nope'), null);
assert.equal(parsePort('18765'), 18765);
assert.equal(parsePort('80'), null);
assert.equal(parsePort('70000'), null);
assert.equal(parsePort('abc'), null);
assert.equal(maskToken(''), '(empty)');
assert.equal(maskToken('abcd'), '****');
assert.equal(maskToken('abcdefghij'), '****ghij');

console.log('cli/parse.test.ts: ok');
