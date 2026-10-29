import assert from 'node:assert/strict';
import { effectiveModelKey } from './dist/settingsModel.js';

assert.equal(
  effectiveModelKey({ baseURL: 'https://api.example/v1/', model: 'gpt-x' }),
  'https://api.example/v1\ngpt-x',
);
assert.equal(
  effectiveModelKey({ baseURL: 'https://api.example/v1', model: 'gpt-x' }),
  effectiveModelKey({ baseURL: 'https://api.example/v1/', model: 'gpt-x' }),
);
assert.notEqual(
  effectiveModelKey({ baseURL: 'https://a/v1', model: 'm1' }),
  effectiveModelKey({ baseURL: 'https://a/v1', model: 'm2' }),
);

console.log('effectiveModelKey.test.mjs: ok');
