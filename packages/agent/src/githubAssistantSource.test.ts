import assert from 'node:assert/strict';
import {
  githubContentsApiUrl,
  githubRawFileUrl,
  isAssistantArchivePath,
  parseGithubAssistantSource,
} from './githubAssistantSource.ts';

assert.equal(isAssistantArchivePath('foo.okbot'), true);
assert.equal(isAssistantArchivePath('foo.ZIP'), true);
assert.equal(isAssistantArchivePath('manifest.json'), false);

{
  const p = parseGithubAssistantSource('https://github.com/acme/helpers');
  assert.deepEqual(p, {
    kind: 'discover',
    owner: 'acme',
    repo: 'helpers',
    ref: 'HEAD',
    label: 'acme/helpers',
  });
}

{
  const p = parseGithubAssistantSource('https://github.com/acme/helpers.git');
  assert.equal(p.kind, 'discover');
  assert.equal((p as { repo: string }).repo, 'helpers');
}

{
  const p = parseGithubAssistantSource('https://github.com/acme/helpers/tree/main/assistant');
  assert.deepEqual(p, {
    kind: 'dir',
    owner: 'acme',
    repo: 'helpers',
    ref: 'main',
    path: 'assistant',
    label: 'acme/helpers/assistant',
  });
}

{
  const p = parseGithubAssistantSource(
    'https://github.com/acme/helpers/blob/main/assistant/manifest.json',
  );
  assert.equal(p.kind, 'dir');
  assert.equal((p as { path: string }).path, 'assistant');
}

{
  const p = parseGithubAssistantSource(
    'https://github.com/acme/helpers/blob/main/packs/demo.okbot',
  );
  assert.equal(p.kind, 'archive');
  assert.ok((p as { url: string }).url.includes('raw.githubusercontent.com'));
  assert.ok((p as { url: string }).url.endsWith('/packs/demo.okbot'));
}

{
  const p = parseGithubAssistantSource(
    'https://github.com/acme/helpers/releases/download/v1.0.0/demo.okbot',
  );
  assert.deepEqual(p, {
    kind: 'archive',
    url: 'https://github.com/acme/helpers/releases/download/v1.0.0/demo.okbot',
    label: 'demo.okbot',
  });
}

{
  const p = parseGithubAssistantSource(
    'https://raw.githubusercontent.com/acme/helpers/main/assistant/manifest.json',
  );
  assert.deepEqual(p, {
    kind: 'dir',
    owner: 'acme',
    repo: 'helpers',
    ref: 'main',
    path: 'assistant',
    label: 'acme/helpers/assistant',
  });
}

{
  const p = parseGithubAssistantSource('https://example.com/files/pack.okbot');
  assert.equal(p.kind, 'archive');
  assert.equal((p as { url: string }).url, 'https://example.com/files/pack.okbot');
}

assert.throws(() => parseGithubAssistantSource(''), /请输入/);
assert.throws(() => parseGithubAssistantSource('https://gitlab.com/a/b'), /GitHub/);
assert.throws(
  () => parseGithubAssistantSource('https://github.com/acme/helpers/archive/refs/heads/main.zip'),
  /整个仓库/,
);

assert.equal(
  githubRawFileUrl('acme', 'helpers', 'main', 'assistant/manifest.json'),
  'https://raw.githubusercontent.com/acme/helpers/main/assistant/manifest.json',
);
assert.equal(
  githubContentsApiUrl('acme', 'helpers', 'assistant', 'main'),
  'https://api.github.com/repos/acme/helpers/contents/assistant?ref=main',
);
assert.equal(
  githubContentsApiUrl('acme', 'helpers', '', 'HEAD'),
  'https://api.github.com/repos/acme/helpers/contents',
);

console.log('githubAssistantSource.test.ts: ok');
