/**
 * Assistant persist indexes http(s) URLs into resources.jsonl.
 */
import assert from 'node:assert/strict';
import {
  indexOwnerLibraryUrlsFromText,
  type LibraryMediaIndexStorage,
} from './turnContext';

const calls: Array<{ url: string; title?: string }> = [];
const storage: LibraryMediaIndexStorage = {
  ownerResourcesDir() {
    return '/tmp/unused';
  },
  indexOwnerResourceFile() {
    return null;
  },
  indexOwnerResourceUrl(_ownerId, input) {
    calls.push({ url: input.url, title: input.title });
    return null;
  },
};

indexOwnerLibraryUrlsFromText(
  storage,
  'bot_x',
  '见 [文档](https://okbot-ai.com/a) 与 https://okbot-ai.com/a/ 以及 https://localhost/x',
);

assert.equal(calls.length, 1);
assert.equal(calls[0]!.url, 'https://okbot-ai.com/a');
assert.equal(calls[0]!.title, '文档');

console.log('libraryUrlIndex.test.ts: ok');
