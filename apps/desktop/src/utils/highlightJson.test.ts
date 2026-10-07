import assert from 'node:assert/strict';
import { escapeHtml, highlightJson } from './highlightJson';

const sample = JSON.stringify(
  { a: 'hi', n: 1, ok: true, x: null, arr: [-2, 3.5], nested: { k: 'v' } },
  null,
  2,
);

const html = highlightJson(sample);

assert.ok(html.includes('turn-trace-json-key'), 'keys highlighted');
assert.ok(html.includes('turn-trace-json-string'), 'strings highlighted');
assert.ok(html.includes('turn-trace-json-number'), 'numbers highlighted');
assert.ok(html.includes('turn-trace-json-bool'), 'bools highlighted');
assert.ok(html.includes('turn-trace-json-null'), 'null highlighted');
assert.ok(html.includes('turn-trace-json-punct'), 'punctuation highlighted');
assert.ok(!html.includes('&quot;a&quot;:') || html.includes('turn-trace-json-key'), 'keys not plain escaped');
assert.ok(html.includes('<span class="turn-trace-json-key">&quot;a&quot;</span>'), 'key a wrapped');
assert.ok(html.includes('<span class="turn-trace-json-string">&quot;hi&quot;</span>'), 'string hi wrapped');
assert.ok(html.includes('<span class="turn-trace-json-number">-2</span>'), 'negative number whole');
assert.ok(html.includes('<span class="turn-trace-json-bool">true</span>'), 'true wrapped');
assert.ok(html.includes('<span class="turn-trace-json-null">null</span>'), 'null wrapped');
assert.equal(escapeHtml('"<>&'), '&quot;&lt;&gt;&amp;');
assert.ok(!/<span class="turn-trace-json-string">[^<]*</.test(html.replace(/<span class="turn-trace-json-string">[^<]*<\/span>/g, '')), 'sanity');

console.log('highlightJson.test.ts: ok');
