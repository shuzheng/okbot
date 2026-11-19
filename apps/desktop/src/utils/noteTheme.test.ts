import assert from 'node:assert/strict';
import { stampNoteHtmlTheme } from './noteTheme';

const stamped = stampNoteHtmlTheme(
  '<!DOCTYPE html><html lang="zh"><head></head><body>hi</body></html>',
  'dark',
);
assert.match(stamped, /<!DOCTYPE html><html lang="zh" data-theme="dark" style="color-scheme:dark">/i);
assert.equal((stamped.match(/<html\b/gi) || []).length, 1);

const replaced = stampNoteHtmlTheme(
  '<html data-theme="light" style="background:red;color-scheme:light"><body></body></html>',
  'dark',
);
assert.match(replaced, /data-theme="dark"/);
assert.doesNotMatch(replaced, /data-theme="light"/);
assert.match(replaced, /style="background:red;color-scheme:dark"/);
assert.doesNotMatch(replaced, /color-scheme:light/);

const unquoted = stampNoteHtmlTheme('<html data-theme=light lang=en><body></body></html>', 'dark');
assert.match(unquoted, /data-theme="dark"/);
assert.doesNotMatch(unquoted, /data-theme=light/);
assert.match(unquoted, /style="color-scheme:dark"/);

const fragment = stampNoteHtmlTheme('<h1>Title</h1>', 'light');
assert.match(fragment, /^<html data-theme="light" style="color-scheme:light"><h1>Title<\/h1><\/html>$/);

const doctypeOnly = stampNoteHtmlTheme('<!DOCTYPE html><head><title>t</title></head><body>x</body>', 'dark');
assert.match(doctypeOnly, /^<!DOCTYPE html><html data-theme="dark" style="color-scheme:dark"><head>/);
assert.match(doctypeOnly, /<\/body><\/html>$/);

const empty = stampNoteHtmlTheme('', 'light');
assert.equal(empty, '<html data-theme="light" style="color-scheme:light"></html>');

console.log('noteTheme.test.ts: ok');
