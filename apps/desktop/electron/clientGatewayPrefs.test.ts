import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LOCAL_GATEWAY_ID,
  defaultClientGatewayPrefs,
  getActive,
  loadPrefs,
  removeGateway,
  savePrefs,
  setActive,
  upsertGateway,
} from './clientGatewayPrefs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-client-gw-'));

const defaults = defaultClientGatewayPrefs();
assert.equal(defaults.activeId, LOCAL_GATEWAY_ID);
assert.equal(defaults.gateways.length, 1);
assert.equal(defaults.gateways[0]!.kind, 'local');

assert.deepEqual(loadPrefs(tmp), defaults);
assert.equal(getActive(tmp).id, LOCAL_GATEWAY_ID);

const withRemote = upsertGateway(
  {
    id: 'office',
    label: 'Office',
    kind: 'remote',
    baseUrl: 'https://gw.example.com:8443/okbot',
    token: ' secret ',
  },
  tmp,
);
assert.equal(withRemote.gateways.length, 2);
const office = withRemote.gateways.find((g) => g.id === 'office');
assert.ok(office);
assert.equal(office!.baseUrl, 'https://gw.example.com:8443/okbot');
assert.equal(office!.token, 'secret');

// Nested under client.json.gateways — no live standalone write.
assert.ok(fs.existsSync(path.join(tmp, 'client.json')));
assert.ok(!fs.existsSync(path.join(tmp, 'gateways.json')));
const nested = JSON.parse(fs.readFileSync(path.join(tmp, 'client.json'), 'utf8')) as {
  gateways?: { activeId?: string; gateways?: unknown[] };
  theme?: string;
};
assert.equal(nested.gateways?.activeId, LOCAL_GATEWAY_ID);
assert.equal(nested.gateways?.gateways?.length, 2);

setActive('office', tmp);
assert.equal(getActive(tmp).id, 'office');
assert.equal(getActive(tmp).kind, 'remote');

// Unknown active id is ignored
const ignored = setActive('missing', tmp);
assert.equal(ignored.activeId, 'office');

// Persist + reload
const reloaded = loadPrefs(tmp);
assert.equal(reloaded.gateways.length, 2);
assert.equal(reloaded.activeId, 'office');

// Cannot remove local
removeGateway(LOCAL_GATEWAY_ID, tmp);
assert.ok(loadPrefs(tmp).gateways.some((g) => g.id === LOCAL_GATEWAY_ID));

// Removing active remote falls back to local
removeGateway('office', tmp);
const afterRemove = loadPrefs(tmp);
assert.equal(afterRemove.gateways.length, 1);
assert.equal(afterRemove.activeId, LOCAL_GATEWAY_ID);

// Corrupt nested section → defaults
{
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'client.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  raw.gateways = '{not-json';
  fs.writeFileSync(path.join(tmp, 'client.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  assert.deepEqual(loadPrefs(tmp), defaults);
}

// upsert updates in place
savePrefs(defaults, tmp);
upsertGateway({ id: 'a', label: 'A', kind: 'remote', baseUrl: 'http://127.0.0.1:9' }, tmp);
upsertGateway({ id: 'a', label: 'A2', kind: 'remote', baseUrl: 'http://127.0.0.1:10' }, tmp);
const updated = loadPrefs(tmp).gateways.filter((g) => g.id === 'a');
assert.equal(updated.length, 1);
assert.equal(updated[0]!.label, 'A2');
assert.equal(updated[0]!.baseUrl, 'http://127.0.0.1:10');

// Fold legacy ~/.okbot/gateways.json into client.json; leave leftover file.
{
  const mig = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-gw-fold-'));
  fs.writeFileSync(
    path.join(mig, 'client.json'),
    `${JSON.stringify(
      {
        theme: 'dark',
        language: 'en',
        microphoneId: '',
        hardwareAcceleration: true,
        autoUpdate: true,
        sidebarDockMagnify: false,
        translucent: true,
        developerMode: false,
        notifications: true,
        closeAction: 'ask',
        window: { x: 1, y: 2, width: 800, height: 600 },
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(mig, 'gateways.json'),
    `${JSON.stringify(
      {
        activeId: 'office',
        gateways: [
          { id: 'local', label: 'Local', kind: 'local' },
          {
            id: 'office',
            label: 'Office',
            kind: 'remote',
            baseUrl: 'https://gw.example.com/okbot',
            token: 'tok',
          },
        ],
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  const folded = loadPrefs(mig);
  assert.equal(folded.activeId, 'office');
  assert.equal(folded.gateways.length, 2);
  const client = JSON.parse(fs.readFileSync(path.join(mig, 'client.json'), 'utf8')) as {
    theme?: string;
    window?: { width: number };
    gateways?: { activeId?: string };
  };
  assert.equal(client.theme, 'dark');
  assert.equal(client.window?.width, 800);
  assert.equal(client.gateways?.activeId, 'office');
  // Leftover standalone file kept for safety (like window.json).
  assert.ok(fs.existsSync(path.join(mig, 'gateways.json')));
  fs.rmSync(mig, { recursive: true, force: true });
}

// Fold userData client-gateways.json when neither nested nor standalone exists.
{
  const mig = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-gw-ud-'));
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-ud-'));
  fs.writeFileSync(
    path.join(ud, 'client-gateways.json'),
    `${JSON.stringify(
      {
        activeId: 'r1',
        gateways: [
          { id: 'local', label: 'Local', kind: 'local' },
          { id: 'r1', label: 'R1', kind: 'remote', baseUrl: 'http://127.0.0.1:9', token: 't' },
        ],
      },
      null,
      2,
    )}
`,
    'utf8',
  );
  const folded = loadPrefs(mig, ud);
  assert.equal(folded.activeId, 'r1');
  assert.equal(folded.gateways.length, 2);
  const client = JSON.parse(fs.readFileSync(path.join(mig, 'client.json'), 'utf8')) as {
    gateways?: { activeId?: string };
  };
  assert.equal(client.gateways?.activeId, 'r1');
  assert.ok(!fs.existsSync(path.join(mig, 'gateways.json')));
  fs.rmSync(mig, { recursive: true, force: true });
  fs.rmSync(ud, { recursive: true, force: true });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('clientGatewayPrefs.test.ts: ok');
