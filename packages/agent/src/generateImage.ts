import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** MiniMax native image models (not OpenAI /v1/images/generations). */
export const MINIMAX_IMAGE_MODELS = ['image-01', 'image-01-live'] as const;
export type MinimaxImageModel = (typeof MINIMAX_IMAGE_MODELS)[number];

export const MINIMAX_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '4:3',
  '3:2',
  '2:3',
  '3:4',
  '9:16',
  '21:9',
] as const;
export type MinimaxAspectRatio = (typeof MINIMAX_ASPECT_RATIOS)[number];

/** Markdown / IPC scheme for images under ~/.okbot/<ownerId>/resources/. */
export const OKBOT_ASSET_SCHEME = 'okbot-asset:';

export type ImageApiCredentials = {
  baseURL: string;
  apiKey: string;
};

export type GenerateImageInput = {
  prompt: string;
  aspectRatio?: string;
  model?: string;
};

export type GenerateImageResult = {
  /** Absolute path on disk. */
  filePath: string;
  /** Relative path under ~/.okbot (e.g. <ownerId>/resources/xxx.png). */
  assetRel: string;
  /** Markdown src the UI resolves via IPC (okbot-asset:…). */
  markdownSrc: string;
  /** Full markdown image line for the model to paste into the reply. */
  markdown: string;
  endpoint: string;
  model: string;
};

/**
 * Build MiniMax native image endpoint from the same provider baseURL used for chat.
 * baseURL is typically `https://api.minimax.cn/v1` or a gateway `…/v1`.
 * Native path is `/v1/image_generation` (not OpenAI `/v1/images/generations`).
 */
export function minimaxImageGenerationUrl(baseURL: string): string {
  const trimmed = (baseURL || '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('baseURL 为空');
  return `${trimmed}/image_generation`;
}

/** Absolute `~/.okbot/<ownerId>/resources` (or a test temp dir). */
export function ownerResourcesDir(okbotRoot: string, ownerId: string): string {
  const id = (ownerId || '').trim();
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) {
    throw new Error('非法 ownerId');
  }
  return path.join(okbotRoot, id, 'resources');
}

export function okbotAssetMarkdownSrc(assetRel: string): string {
  const rel = assetRel.replace(/^\/+/, '').replace(/\\/g, '/');
  return `${OKBOT_ASSET_SCHEME}${rel}`;
}

/** Build assetRel stored in markdown: `<ownerId>/resources/<fileName>`. */
export function ownerResourceAssetRel(ownerId: string, fileName: string): string {
  const id = (ownerId || '').trim();
  const name = (fileName || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error('非法 ownerId');
  }
  if (!name || name.includes('..') || name.includes('/')) {
    throw new Error('非法资源文件名');
  }
  return `${id}/resources/${name}`;
}

function normalizeAspectRatio(raw: string | undefined): MinimaxAspectRatio {
  const v = (raw || '1:1').trim();
  if ((MINIMAX_ASPECT_RATIOS as readonly string[]).includes(v)) {
    return v as MinimaxAspectRatio;
  }
  return '1:1';
}

function normalizeImageModel(raw: string | undefined): MinimaxImageModel {
  const v = (raw || 'image-01').trim();
  if ((MINIMAX_IMAGE_MODELS as readonly string[]).includes(v)) {
    return v as MinimaxImageModel;
  }
  return 'image-01';
}

type MinimaxImageResponse = {
  data?: {
    image_urls?: string[];
    image_base64?: string[];
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  id?: string;
};

export function parseMinimaxImageResponse(json: unknown): {
  base64?: string;
  url?: string;
  statusCode: number;
  statusMsg: string;
} {
  const body = (json && typeof json === 'object' ? json : {}) as MinimaxImageResponse;
  const statusCode = body.base_resp?.status_code ?? -1;
  const statusMsg = body.base_resp?.status_msg ?? (statusCode === 0 ? 'success' : 'unknown error');
  const b64 = body.data?.image_base64?.[0];
  const url = body.data?.image_urls?.[0];
  return {
    base64: typeof b64 === 'string' && b64.trim() ? b64.trim() : undefined,
    url: typeof url === 'string' && url.trim() ? url.trim() : undefined,
    statusCode,
    statusMsg,
  };
}

function stripDataUrlPrefix(b64: string): string {
  const m = /^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/s.exec(b64);
  return m?.[1] ?? b64;
}

function extFromBytes(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return '.png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return '.jpg';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return '.webp';
  }
  return '.png';
}

async function decodeImageBytes(parsed: {
  base64?: string;
  url?: string;
}): Promise<Buffer> {
  if (parsed.base64) {
    return Buffer.from(stripDataUrlPrefix(parsed.base64), 'base64');
  }
  if (parsed.url) {
    const res = await fetch(parsed.url);
    if (!res.ok) {
      throw new Error(`下载生成图片失败：HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  throw new Error('响应中没有 image_base64 或 image_urls');
}

export type GenerateImageSaveOpts = {
  fetchImpl?: typeof fetch;
  /** Absolute directory to write into (`~/.okbot/<ownerId>/resources`). */
  resourcesDir: string;
  /** Bot or squad id; used in markdown `okbot-asset:<ownerId>/resources/…`. */
  ownerId: string;
};

/**
 * Call MiniMax-native `POST {baseURL}/image_generation`, save under the
 * owner `resources/` dir, return markdown the assistant must echo.
 */
export async function generateImageWithMinimax(
  creds: ImageApiCredentials,
  input: GenerateImageInput,
  opts: GenerateImageSaveOpts,
): Promise<GenerateImageResult> {
  const prompt = (input.prompt || '').trim();
  if (!prompt) throw new Error('prompt 不能为空');
  if (prompt.length > 1500) throw new Error('prompt 最长 1500 字符');

  const apiKey = (creds.apiKey || '').trim();
  if (!apiKey) throw new Error('API Key 为空，请先在设置里配置模型供应商');

  const model = normalizeImageModel(input.model);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const endpoint = minimaxImageGenerationUrl(creds.baseURL);
  const fetchImpl = opts?.fetchImpl ?? fetch;

  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      aspect_ratio: aspectRatio,
      response_format: 'base64',
      n: 1,
      prompt_optimizer: true,
    }),
  });

  const rawText = await res.text();
  let json: unknown;
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(
      `图片生成接口返回非 JSON（HTTP ${res.status}）：${rawText.slice(0, 400)}`,
    );
  }

  const parsed = parseMinimaxImageResponse(json);
  if (!res.ok && parsed.statusCode === -1) {
    throw new Error(`图片生成 HTTP ${res.status}：${rawText.slice(0, 400)}`);
  }
  if (parsed.statusCode !== 0) {
    throw new Error(
      `图片生成失败（status_code=${parsed.statusCode}）：${parsed.statusMsg || 'unknown'}`,
    );
  }

  const bytes = await decodeImageBytes(parsed);
  if (!bytes.length) throw new Error('生成图片数据为空');

  const ownerId = (opts.ownerId || '').trim();
  const resourcesDir = (opts.resourcesDir || '').trim();
  if (!ownerId) throw new Error('ownerId 为空，无法保存图片到助手/小队 resources');
  if (!resourcesDir) throw new Error('resourcesDir 为空，无法保存图片');

  const ext = extFromBytes(bytes);
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const fileName = `${id}${ext}`;
  const assetRel = ownerResourceAssetRel(ownerId, fileName);
  const filePath = path.join(resourcesDir, fileName);
  await fs.mkdir(resourcesDir, { recursive: true });
  await fs.writeFile(filePath, bytes);

  const markdownSrc = okbotAssetMarkdownSrc(assetRel);
  const alt = prompt.length > 80 ? `${prompt.slice(0, 77)}…` : prompt;
  const markdown = `![${alt.replace(/[[\]]/g, '')}](${markdownSrc})`;

  return {
    filePath,
    assetRel,
    markdownSrc,
    markdown,
    endpoint,
    model,
  };
}

export function formatGenerateImageToolOutput(result: GenerateImageResult): string {
  return [
    '图片已生成并保存到本机。',
    `endpoint: ${result.endpoint}`,
    `model: ${result.model}`,
    `path: ${result.filePath}`,
    `asset: ${result.assetRel}`,
    '',
    '请把下面这一行 markdown **原样**写入你的回复（不要改 src），用户气泡才能内嵌显示图片：',
    result.markdown,
  ].join('\n');
}
