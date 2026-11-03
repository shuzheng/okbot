import assert from 'node:assert/strict';
import { ensureSrcdocBase, inDocumentHashId } from './noteAnchors';

assert.equal(inDocumentHashId('#rules'), 'rules');
assert.equal(inDocumentHashId('  #quotes  '), 'quotes');
assert.equal(inDocumentHashId('#'), '');
assert.equal(inDocumentHashId('#%E8%A7%84%E5%88%99'), '规则');
assert.equal(inDocumentHashId('about:srcdoc#mapping'), 'mapping');
assert.equal(inDocumentHashId('ABOUT:SRCDOC#x'), 'x');
assert.equal(inDocumentHashId('about:srcdoc'), '');
assert.equal(inDocumentHashId(null), null);
assert.equal(inDocumentHashId(undefined), null);
assert.equal(inDocumentHashId(''), null);
assert.equal(inDocumentHashId('https://example.com#x'), null);
assert.equal(inDocumentHashId('/path#x'), null);
assert.equal(inDocumentHashId('foo.html#x'), null);
assert.equal(inDocumentHashId('mailto:a@b.c'), null);

const withHead = ensureSrcdocBase('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><a href="#a">a</a></body></html>');
assert.match(withHead, /<head><base href="about:srcdoc">/i);
assert.ok(!withHead.slice(withHead.indexOf('about:srcdoc') + 20).includes('<base href="about:srcdoc">'));

const already = ensureSrcdocBase('<html><head><base href="about:srcdoc"><title>t</title></head><body></body></html>');
assert.equal((already.match(/<base\b/gi) || []).length, 1);

const noHead = ensureSrcdocBase('<html><body>x</body></html>');
assert.match(noHead, /<head><base href="about:srcdoc"><\/head>/i);

console.log('noteAnchors.test.ts: ok');
