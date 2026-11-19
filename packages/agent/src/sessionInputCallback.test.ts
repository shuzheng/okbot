import assert from 'node:assert/strict';
import type { AgentInputItem } from '@openai/agents';
import { enrichLastUserContentSessionInputCallback } from './visionInput.js';
import { quoteSessionInputCallback } from './quoteContext.js';

{
  const first: AgentInputItem = { role: 'user', content: 'earlier' } as AgentInputItem;
  const last: AgentInputItem = { role: 'user', content: 'disk body' } as AgentInputItem;
  const history = [first, last];
  const out = enrichLastUserContentSessionInputCallback('model text')(history);
  assert.equal(out, history, 'must return the same history array');
  assert.equal(out[0], first, 'earlier items keep identity');
  assert.equal(out[1], last, 'last user item must be mutated in place');
  assert.equal((last as { content: unknown }).content, 'model text');
  assert.equal((first as { content: unknown }).content, 'earlier');
}

{
  const last: AgentInputItem = { role: 'user', content: 'disk body' } as AgentInputItem;
  const history = [last];
  const out = quoteSessionInputCallback('quoted model text')(history);
  assert.equal(out, history, 'quote callback must return the same history array');
  assert.equal(out[0], last, 'quote callback must mutate the last user item in place');
  assert.equal((last as { content: unknown }).content, 'quoted model text');
}

{
  const history: AgentInputItem[] = [];
  assert.equal(enrichLastUserContentSessionInputCallback('x')(history), history);
}

{
  const last: AgentInputItem = { role: 'assistant', content: 'reply' } as AgentInputItem;
  const history = [last];
  const out = enrichLastUserContentSessionInputCallback('x')(history);
  assert.equal(out, history);
  assert.equal((last as { content: unknown }).content, 'reply', 'non-user last item is left unchanged');
}

console.log('sessionInputCallback.test.ts: ok');
