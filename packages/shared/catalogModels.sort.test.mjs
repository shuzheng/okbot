import assert from 'node:assert/strict';
import {
  compareCatalogModels,
  catalogModelSortKey,
  sortCatalogModels,
  normalizeModelSettings,
  dedupeCatalogModels,
} from './dist/index.js';

assert.equal(catalogModelSortKey({ id: 'model-x', name: 'Model X' }), 'Model X');
assert.equal(catalogModelSortKey({ id: 'model-x', name: '  ' }), 'model-x');
assert.equal(catalogModelSortKey({ id: 'model-x', name: '' }), 'model-x');

const unsorted = [
  { id: 'z-id', name: 'Zeta' },
  { id: 'a-id', name: 'alpha' },
  { id: 'm-id', name: 'Mu' },
  { id: 'b-id', name: '' }, // falls back to id
];
const sorted = sortCatalogModels(unsorted);
assert.deepEqual(
  sorted.map((m) => m.id),
  ['a-id', 'b-id', 'm-id', 'z-id'],
);
assert.deepEqual(
  sorted.map((m) => catalogModelSortKey(m)),
  ['alpha', 'b-id', 'Mu', 'Zeta'],
);

// Stable: equal display names keep relative order via id tiebreak
const twins = [
  { id: 'b', name: 'Same' },
  { id: 'a', name: 'Same' },
];
assert.deepEqual(
  sortCatalogModels(twins).map((m) => m.id),
  ['a', 'b'],
);
assert.ok(compareCatalogModels(twins[0], twins[1]) > 0);

// Does not mutate input
const orig = unsorted.map((m) => m.id);
sortCatalogModels(unsorted);
assert.deepEqual(
  unsorted.map((m) => m.id),
  orig,
);

// normalizeModelSettings sorts models A–Z; providers stay in input order
const normalized = normalizeModelSettings({
  providers: [
    {
      id: 'prov_b',
      name: 'Beta Prov',
      baseURL: 'https://b.example',
      apiKey: 'k',
      models: [
        { id: 'z', name: 'Zebra' },
        { id: 'a', name: 'Ant' },
      ],
    },
    {
      id: 'prov_a',
      name: 'Alpha Prov',
      baseURL: 'https://a.example',
      apiKey: 'k',
      models: [{ id: 'm', name: 'Mid' }],
    },
  ],
  defaultProviderId: 'prov_b',
  defaultModelId: 'z',
});
assert.deepEqual(
  normalized.providers.map((p) => p.id),
  ['prov_b', 'prov_a'],
);
assert.deepEqual(
  normalized.providers[0].models.map((m) => m.id),
  ['a', 'z'],
);

// dedupe then sort: first-wins identity preserved, then ordered
const deduped = sortCatalogModels(
  dedupeCatalogModels([
    { id: '2', name: 'B', contextWindow: 1, maxTokens: null, enabled: true },
    { id: '1', name: 'A', contextWindow: 1, maxTokens: null, enabled: true },
    { id: '2', name: 'B-dup', contextWindow: 1, maxTokens: null, enabled: true },
  ]),
);
assert.deepEqual(
  deduped.map((m) => `${m.id}:${m.name}`),
  ['1:A', '2:B'],
);

console.log('catalogModels.sort.test.mjs: ok');
