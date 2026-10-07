import assert from 'node:assert/strict';
import {
  formatWebSearchToolOutput,
  webSearch,
  webSearchNotConfiguredMessage,
} from './webSearch.js';

await assert.rejects(
  () => webSearch({ provider: 'tavily', apiKey: '', baseURL: '' }, 'hello'),
  /设置/,
);
assert.match(webSearchNotConfiguredMessage(), /设置 → 工具 → 网页/);

{
  const result = await webSearch(
    { provider: 'tavily', apiKey: 'tvly-test', baseURL: '' },
    'okbot',
    {
      limit: 2,
      fetchImpl: (async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        assert.equal(body.query, 'okbot');
        assert.equal(body.api_key, 'tvly-test');
        return new Response(
          JSON.stringify({
            results: [
              { title: 'A', url: 'https://a.example', content: 'alpha' },
              { title: 'B', url: 'https://b.example', content: 'beta' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch,
    },
  );
  assert.equal(result.hits.length, 2);
  assert.match(formatWebSearchToolOutput(result), /Tavily/);
  assert.match(formatWebSearchToolOutput(result), /https:\/\/a\.example/);
}

{
  const result = await webSearch(
    { provider: 'brave', apiKey: 'brave-key', baseURL: '' },
    'bots',
    {
      fetchImpl: (async (url, init) => {
        assert.match(String(url), /api\.search\.brave\.com/);
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers['X-Subscription-Token'], 'brave-key');
        return new Response(
          JSON.stringify({
            web: { results: [{ title: 'Brave Hit', url: 'https://brave.example', description: 'desc' }] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch,
    },
  );
  assert.equal(result.provider, 'brave');
  assert.equal(result.hits[0]?.title, 'Brave Hit');
}

{
  const result = await webSearch(
    { provider: 'serper', apiKey: 'serper-key', baseURL: 'https://proxy.example' },
    'x',
    {
      fetchImpl: (async (url, init) => {
        assert.equal(String(url), 'https://proxy.example/search');
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers['X-API-KEY'], 'serper-key');
        return new Response(
          JSON.stringify({ organic: [{ title: 'S', link: 'https://s.example', snippet: 'snip' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch,
    },
  );
  assert.equal(result.hits[0]?.url, 'https://s.example');
}

console.log('webSearch.test.ts: ok');
