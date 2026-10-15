import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  aspectRatioToOpenAISize,
  formatGenerateImageToolOutput,
  generateImage,
  inferImageCapability,
  isMinimaxImageHost,
  isOpenAIImageHost,
  mediaGatewayPathname,
  minimaxImageGenerationUrl,
  normalizeReplyMediaMarkdown,
  okbotAssetMarkdownSrc,
  openAIImageGenerationsUrl,
  ownerResourceAssetRel,
  parseMinimaxImageResponse,
  parseOpenAIImagesResponse,
} from './generateImage.js';

assert.equal(
  openAIImageGenerationsUrl('https://api.openai.com/v1'),
  'https://api.openai.com/v1/images/generations',
);
assert.equal(
  openAIImageGenerationsUrl('https://api.openai.com/v1/'),
  'https://api.openai.com/v1/images/generations',
);
assert.equal(
  minimaxImageGenerationUrl('https://api.minimax.cn/v1'),
  'https://api.minimax.cn/v1/image_generation',
);

assert.equal(
  okbotAssetMarkdownSrc('bot_20260101_1/resources/abc.png'),
  '/v1/media/bot_20260101_1/resources/abc.png',
);
assert.equal(
  mediaGatewayPathname('bot_20260101_1/resources/abc.png'),
  '/v1/media/bot_20260101_1/resources/abc.png',
);
assert.equal(
  normalizeReplyMediaMarkdown(
    'see ![cat](okbot-asset:bot_1/resources/a.png) and ![x](file:///Users/u/.okbot/bot_1/resources/a.png)',
  ),
  'see ![cat](/v1/media/bot_1/resources/a.png) and ![x](/v1/media/bot_1/resources/a.png)',
);
assert.equal(
  normalizeReplyMediaMarkdown('![keep](data:image/png;base64,aaa)'),
  '![keep](data:image/png;base64,aaa)',
);
assert.equal(
  ownerResourceAssetRel('bot_20260101_1', 'abc.png'),
  'bot_20260101_1/resources/abc.png',
);

assert.equal(isOpenAIImageHost('https://api.openai.com/v1'), true);
assert.equal(isOpenAIImageHost('https://myres.openai.azure.com/openai/v1'), true);
assert.equal(isOpenAIImageHost('https://api.minimax.cn/v1'), false);
assert.equal(isOpenAIImageHost('https://api.deepseek.com/v1'), false);
assert.equal(isMinimaxImageHost('https://api.minimax.cn/v1'), true);
assert.equal(isMinimaxImageHost('https://api.openai.com/v1'), false);

assert.equal(aspectRatioToOpenAISize('1:1'), '1024x1024');
assert.equal(aspectRatioToOpenAISize('16:9'), '1792x1024');
assert.equal(aspectRatioToOpenAISize('9:16'), '1024x1792');

{
  const ok = parseOpenAIImagesResponse({
    data: [{ b64_json: 'bbb' }],
  });
  assert.equal(ok.base64, 'bbb');
  const url = parseOpenAIImagesResponse({
    data: [{ url: 'https://example.com/x.png' }],
  });
  assert.equal(url.url, 'https://example.com/x.png');
  const err = parseOpenAIImagesResponse({
    error: { message: 'billing hard limit' },
  });
  assert.equal(err.errorMessage, 'billing hard limit');
}

{
  const ok = parseMinimaxImageResponse({
    data: { image_base64: ['aaa'] },
    base_resp: { status_code: 0, status_msg: 'success' },
  });
  assert.equal(ok.base64, 'aaa');
  assert.equal(ok.statusCode, 0);
}

// --- inference (MiniMax + OpenAI-compatible) ---
{
  const oai = inferImageCapability({ baseURL: 'https://api.openai.com/v1' });
  assert.ok(oai);
  assert.equal(oai!.protocol, 'openai_images');
  assert.ok(oai!.models.includes('dall-e-3'));
  assert.equal(oai!.defaultModel, 'dall-e-3');

  const byCatalogOai = inferImageCapability({
    baseURL: 'https://llm.proxy.local/v1',
    catalogModelIds: ['gpt-4o', 'dall-e-3', 'gpt-image-1'],
  });
  assert.equal(byCatalogOai?.protocol, 'openai_images');
  assert.deepEqual(byCatalogOai!.models, ['dall-e-3', 'gpt-image-1']);
  assert.equal(byCatalogOai!.defaultModel, 'dall-e-3');

  const mmHost = inferImageCapability({ baseURL: 'https://api.minimax.cn/v1' });
  assert.equal(mmHost?.protocol, 'minimax');
  assert.ok(mmHost!.models.includes('image-01'));

  const mmName = inferImageCapability({
    baseURL: 'https://gateway.example.com/v1',
    providerName: 'My MiniMax',
  });
  assert.equal(mmName?.protocol, 'minimax');

  const mmCatalog = inferImageCapability({
    baseURL: 'https://aihub.firstshare.cn/v1',
    catalogModelIds: ['MiniMax-M1', 'image-01'],
  });
  assert.equal(mmCatalog?.protocol, 'minimax');
  assert.equal(mmCatalog!.defaultModel, 'image-01');

  const none = inferImageCapability({
    baseURL: 'https://api.deepseek.com/v1',
    catalogModelIds: ['deepseek-chat'],
  });
  assert.equal(none, null);

  const empty = inferImageCapability({ baseURL: '' });
  assert.equal(empty, null);
}


async function testOpenAIRoundTrip() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'okbot-img-oai-'));
  const ownerId = 'bot_test_oai';
  const resourcesDir = path.join(root, ownerId, 'resources');
  await fs.mkdir(path.join(root, ownerId));
  let calledUrl = '';
  let calledBody: Record<string, unknown> = {};
  const fakeFetch: typeof fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = JSON.parse(String(init?.body ?? '{}'));
    assert.equal(init?.method, 'POST');
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    assert.equal(auth, 'Bearer sk-test');
    return new Response(
      JSON.stringify({
        data: [{ b64_json: png.toString('base64') }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await generateImage(
    {
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      catalogModelIds: ['gpt-4o', 'dall-e-3'],
    },
    { prompt: 'a cat', aspectRatio: '16:9', model: 'dall-e-3' },
    { fetchImpl: fakeFetch, resourcesDir, ownerId },
  );

  assert.equal(calledUrl, 'https://api.openai.com/v1/images/generations');
  assert.equal(calledBody.model, 'dall-e-3');
  assert.equal(calledBody.size, '1792x1024');
  assert.equal(calledBody.response_format, 'b64_json');
  assert.equal(result.protocol, 'openai_images');
  assert.ok(result.markdown.includes('/v1/media/'));
  assert.ok(!result.markdown.includes('okbot-asset:'));
  assert.ok(!result.markdown.includes('data:'));
  assert.ok(!result.markdown.includes('file:'));
  assert.ok(result.filePath.includes(`${path.sep}${ownerId}${path.sep}resources${path.sep}`));
  assert.equal(result.assetRel.startsWith(`${ownerId}/resources/`), true);
  const saved = await fs.readFile(result.filePath);
  assert.equal(saved.equals(png), true);

  const out = formatGenerateImageToolOutput(result);
  assert.ok(out.includes(result.markdown));
  assert.ok(out.includes('endpoint: https://api.openai.com/v1/images/generations'));
  assert.ok(out.includes('protocol: openai_images'));
  assert.ok(out.includes('禁止改成 data:'));

  await fs.rm(root, { recursive: true, force: true });
}

async function testDispatchAndErrors() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'okbot-img-disp-'));
  const ownerId = 'bot_disp';
  const resourcesDir = path.join(root, ownerId, 'resources');
  await fs.mkdir(path.join(root, ownerId));

  // Dispatch via catalog on non-OpenAI host
  let hit = '';
  const fakeFetch: typeof fetch = async (input) => {
    hit = String(input);
    return new Response(
      JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }),
      { status: 200 },
    );
  };
  const r = await generateImage(
    {
      baseURL: 'https://proxy.local/v1',
      apiKey: 'k',
      catalogModelIds: ['dall-e-3'],
    },
    { prompt: 'x' },
    { fetchImpl: fakeFetch, resourcesDir, ownerId },
  );
  assert.equal(r.protocol, 'openai_images');
  assert.equal(hit, 'https://proxy.local/v1/images/generations');

  // Unsupported provider
  await assert.rejects(
    () =>
      generateImage(
        { baseURL: 'https://api.deepseek.com/v1', apiKey: 'k' },
        { prompt: 'x' },
        { resourcesDir, ownerId },
      ),
    /没有可用的文生图|不支持文生图/,
  );

  // OpenAI 404
  const fetch404: typeof fetch = async () =>
    new Response('not found', { status: 404 });
  await assert.rejects(
    () =>
      generateImage(
        { baseURL: 'https://api.openai.com/v1', apiKey: 'k' },
        { prompt: 'x' },
        { fetchImpl: fetch404, resourcesDir, ownerId },
      ),
    /HTTP 404/,
  );

  // Owner deleted while the image was being generated: nothing is recreated.
  await fs.rm(path.join(root, ownerId), { recursive: true, force: true });
  await assert.rejects(
    () =>
      generateImage(
        { baseURL: 'https://proxy.local/v1', apiKey: 'k', catalogModelIds: ['dall-e-3'] },
        { prompt: 'x' },
        { fetchImpl: fakeFetch, resourcesDir, ownerId },
      ),
    /owner_deleted/,
  );
  assert.equal(await fs.stat(path.join(root, ownerId)).then(() => true, () => false), false);

  await fs.rm(root, { recursive: true, force: true });
}


async function testMinimaxRoundTrip() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'okbot-img-mm-'));
  const ownerId = 'bot_test_mm';
  const resourcesDir = path.join(root, ownerId, 'resources');
  await fs.mkdir(path.join(root, ownerId));
  let calledUrl = '';
  const fakeFetch: typeof fetch = async (input, init) => {
    calledUrl = String(input);
    assert.equal(init?.method, 'POST');
    return new Response(
      JSON.stringify({
        data: { image_base64: [png.toString('base64')] },
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const result = await generateImage(
    { baseURL: 'https://api.minimax.cn/v1', apiKey: 'k', providerName: 'MiniMax' },
    { prompt: 'a sheep', aspectRatio: '1:1' },
    { fetchImpl: fakeFetch, resourcesDir, ownerId },
  );
  assert.equal(calledUrl, 'https://api.minimax.cn/v1/image_generation');
  assert.equal(result.protocol, 'minimax');
  assert.ok(result.markdown.includes('/v1/media/'));
  assert.ok(!result.markdown.includes('okbot-asset:'));
  const saved = await fs.readFile(result.filePath);
  assert.equal(saved.equals(png), true);
  await fs.rm(root, { recursive: true, force: true });
}

await testOpenAIRoundTrip();
await testMinimaxRoundTrip();
await testDispatchAndErrors();
console.log('generateImage.test.ts: ok');
