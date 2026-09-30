import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  formatGenerateImageToolOutput,
  generateImageWithMinimax,
  minimaxImageGenerationUrl,
  okbotAssetMarkdownSrc,
  ownerResourceAssetRel,
  parseMinimaxImageResponse,
} from './generateImage.js';

assert.equal(
  minimaxImageGenerationUrl('https://api.minimax.cn/v1'),
  'https://api.minimax.cn/v1/image_generation',
);
assert.equal(
  minimaxImageGenerationUrl('https://api.minimax.cn/v1/'),
  'https://api.minimax.cn/v1/image_generation',
);
assert.equal(
  minimaxImageGenerationUrl('https://aihub.firstshare.cn/v1'),
  'https://aihub.firstshare.cn/v1/image_generation',
);

assert.equal(
  okbotAssetMarkdownSrc('bot_20260101_1/resources/abc.png'),
  'okbot-asset:bot_20260101_1/resources/abc.png',
);
assert.equal(
  ownerResourceAssetRel('bot_20260101_1', 'abc.png'),
  'bot_20260101_1/resources/abc.png',
);

{
  const ok = parseMinimaxImageResponse({
    data: { image_base64: ['aaa'] },
    base_resp: { status_code: 0, status_msg: 'success' },
  });
  assert.equal(ok.statusCode, 0);
  assert.equal(ok.base64, 'aaa');

  const fail = parseMinimaxImageResponse({
    base_resp: { status_code: 1004, status_msg: 'auth' },
  });
  assert.equal(fail.statusCode, 1004);
  assert.equal(fail.statusMsg, 'auth');
}

async function testGenerateRoundTrip() {
  // 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'okbot-img-'));
  const ownerId = 'bot_test_1';
  const resourcesDir = path.join(root, ownerId, 'resources');
  let calledUrl = '';
  const fakeFetch: typeof fetch = async (input, init) => {
    calledUrl = String(input);
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body ?? '{}'));
    assert.equal(body.model, 'image-01');
    assert.equal(body.response_format, 'base64');
    assert.equal(body.prompt, 'a panda');
    return new Response(
      JSON.stringify({
        data: { image_base64: [png.toString('base64')] },
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await generateImageWithMinimax(
    { baseURL: 'https://api.minimax.cn/v1', apiKey: 'test-key' },
    { prompt: 'a panda', aspectRatio: '1:1' },
    { fetchImpl: fakeFetch, resourcesDir, ownerId },
  );

  assert.equal(calledUrl, 'https://api.minimax.cn/v1/image_generation');
  assert.ok(result.filePath.includes(`${path.sep}${ownerId}${path.sep}resources${path.sep}`));
  assert.ok(result.markdown.startsWith(`![a panda](okbot-asset:${ownerId}/resources/`));
  assert.ok(result.markdown.endsWith('.png)'));
  assert.equal(result.assetRel.startsWith(`${ownerId}/resources/`), true);
  const saved = await fs.readFile(result.filePath);
  assert.equal(saved.equals(png), true);

  const out = formatGenerateImageToolOutput(result);
  assert.ok(out.includes(result.markdown));
  assert.ok(out.includes('endpoint: https://api.minimax.cn/v1/image_generation'));

  await fs.rm(root, { recursive: true, force: true });
}

await testGenerateRoundTrip();
console.log('generateImage.test.ts: ok');
