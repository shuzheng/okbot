/**
 * Vision attachment → multimodal chat-completions content.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_TOOL_PREFERENCES } from '@okbot/shared';
import { buildAgentInstructions } from './instructions.ts';
import {
  buildMultimodalUserContent,
  encodeImageFileAsDataUrl,
  mimeTypeForImagePath,
  stripImageLinesFromAttachedBlock,
  sniffImageMime,
  MAX_VISION_IMAGE_COUNT,
  VISION_TURN_INSTRUCTION,
} from './visionInput.ts';
import { DEFAULT_SECURITY } from '@okbot/shared';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// mime mapping
assert(mimeTypeForImagePath('/tmp/a.PNG') === 'image/png', 'png mime');
assert(mimeTypeForImagePath('/tmp/a.jpg') === 'image/jpeg', 'jpg mime');
assert(mimeTypeForImagePath('/tmp/a.heic') === null, 'heic unsupported');

// strip image lines from [Attached]
const wired = [
  '[Attached]',
  '- image: /Users/me/pic.png',
  '- file: /Users/me/notes.txt',
  '- folder: /Users/me/docs',
  '',
  '请 OCR 这张图',
].join('\n');
const stripped = stripImageLinesFromAttachedBlock(wired);
assert(!stripped.includes('image:'), 'image line removed');
assert(stripped.includes('- file: /Users/me/notes.txt'), 'file kept');
assert(stripped.includes('- folder: /Users/me/docs'), 'folder kept');
assert(stripped.includes('请 OCR 这张图'), 'body kept');
assert(
  stripImageLinesFromAttachedBlock('plain text') === 'plain text',
  'non-attached passthrough',
);

// 1x1 PNG
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-vision-'));
const pngPath = path.join(dir, 'dot.png');
fs.writeFileSync(pngPath, PNG_1X1);

const dataUrl = await encodeImageFileAsDataUrl(pngPath);
assert(dataUrl.startsWith('data:image/png;base64,'), 'data url prefix');
assert(dataUrl.length > 'data:image/png;base64,'.length, 'has payload');

const parts = await buildMultimodalUserContent(wired, [{ path: pngPath, name: 'dot.png' }]);
assert(parts.length >= 2, 'text + image parts');
assert(parts[0]!.type === 'input_text', 'first is text');
assert(parts[0]!.type === 'input_text' && !parts[0].text.includes('- image:'), 'no image path line');
assert(parts[0]!.type === 'input_text' && parts[0].text.includes('notes.txt'), 'keeps file path');
const img = parts.find((p) => p.type === 'input_image');
assert(img && img.type === 'input_image' && img.image.startsWith('data:image/png;base64,'), 'input_image data url');

const imageOnly = await buildMultimodalUserContent('', [{ path: pngPath }]);
assert(imageOnly.some((p) => p.type === 'input_image'), 'image-only has image');
assert(imageOnly.some((p) => p.type === 'input_text'), 'image-only has hint text');

const withVision = buildAgentInstructions(
  '测试',
  '',
  [],
  DEFAULT_TOOL_PREFERENCES,
  '能力边界：无图像处理能力；只支持文本。',
  undefined,
  undefined,
  undefined,
  undefined,
  true,
);
assert(withVision.includes(VISION_TURN_INSTRUCTION), 'vision turn instruction injected');
assert(withVision.includes('无图像处理能力'), 'AGENTS claim still present for context');

const noVision = buildAgentInstructions(
  '测试',
  '',
  [],
  DEFAULT_TOOL_PREFERENCES,
  '能力边界：无图像处理能力；只支持文本。',
);
assert(!noVision.includes('本回合视觉输入'), 'no vision instruction without flag');

const quoted = [
  '引用：',
  '上一句',
  '',
  '[Attached]',
  '- image: /Users/me/secret.png',
  '- file: /Users/me/notes.txt',
  '',
  '看图',
].join('\n');
const quotedStripped = stripImageLinesFromAttachedBlock(quoted);
assert(!quotedStripped.includes('secret.png'), 'quote+image path stripped');
assert(quotedStripped.includes('- file: /Users/me/notes.txt'), 'file path kept after quote');
assert(quotedStripped.includes('看图'), 'body kept after quote');

assert(sniffImageMime(PNG_1X1) === 'image/png', 'png magic');
const jpgNamed = path.join(dir, 'fake.jpg');
fs.writeFileSync(jpgNamed, PNG_1X1);
let sniffThrew = false;
try {
  await encodeImageFileAsDataUrl(jpgNamed);
} catch (err) {
  sniffThrew = true;
  assert(String(err).includes('不符'), String(err));
}
assert(sniffThrew, 'mismatched magic rejected');

let denied = false;
try {
  await encodeImageFileAsDataUrl(pngPath, { security: DEFAULT_SECURITY });
} catch (err) {
  denied = true;
  assert(String(err).includes('拦截') || String(err).includes('不允许') || String(err).includes('范围'), String(err));
}
assert(denied, 'vision path uses checkPathAllowed');

const many = Array.from({ length: MAX_VISION_IMAGE_COUNT + 1 }, () => ({ path: pngPath, name: 'dot.png' }));
const capped = await buildMultimodalUserContent('hi', many);
const imgs = capped.filter((part) => part.type === 'input_image');
assert(imgs.length === MAX_VISION_IMAGE_COUNT, 'image count cap');
const note = capped.find((part) => part.type === 'input_text');
assert(note && note.type === 'input_text' && note.text.includes('其余已忽略'), 'cap note');

console.log('visionInput.test.ts OK');

fs.rmSync(dir, { recursive: true, force: true });
