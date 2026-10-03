import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Aspect ratios accepted by the generate_image tool (mapped to OpenAI `size`). */
export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '4:3',
  '3:2',
  '2:3',
  '3:4',
  '9:16',
  '21:9',
] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

/** Common OpenAI Images API sizes. */
export const OPENAI_IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const;
export type OpenAIImageSize = (typeof OPENAI_IMAGE_SIZES)[number];

/** Default OpenAI-style image models when host is OpenAI but catalog has none. */
export const OPENAI_DEFAULT_IMAGE_MODELS = ['dall-e-3', 'dall-e-2', 'gpt-image-1'] as const;

/** Markdown / IPC scheme for images under ~/.okbot/<ownerId>/resources/. */
export const OKBOT_ASSET_SCHEME = 'okbot-asset:';

/** Sole supported image protocol: OpenAI-compatible Images API. */
export type ImageProtocol = 'openai_images';

/**
 * Inferred image-gen capability for the current chat provider.
 * Used both to gate `generate_image` tool exposure and to pick models.
 */
export type ImageCapability = {
  protocol: ImageProtocol;
  /** Models advertised in the tool schema. */
  models: string[];
  defaultModel: string;
};

export type ImageApiCredentials = {
  baseURL: string;
  apiKey: string;
  /** Provider catalog model ids (optional; helps infer OpenAI-compatible image models). */
  catalogModelIds?: string[];
  /** Provider display name (unused for inference; kept for callers). */
  providerName?: string;
};

export type GenerateImageInput = {
  prompt: string;
  aspectRatio?: string;
  model?: string;
  /** OpenAI Images `size` (overrides aspectRatio mapping). */
  size?: string;
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
  protocol: ImageProtocol;
};

/**
 * OpenAI-compatible Images API: POST {baseURL}/images/generations
 * (baseURL typically ends with `/v1`).
 */
export function openAIImageGenerationsUrl(baseURL: string): string {
  const trimmed = (baseURL || '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('baseURL 为空');
  return `${trimmed}/images/generations`;
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

function hostnameOf(baseURL: string): string {
  const raw = (baseURL || '').trim();
  if (!raw) return '';
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Host looks like OpenAI or Azure OpenAI (Images API available). */
export function isOpenAIImageHost(baseURL: string): boolean {
  const host = hostnameOf(baseURL);
  if (!host) return /openai\.com|openai\.azure/i.test(baseURL || '');
  return (
    host === 'api.openai.com' ||
    host.endsWith('.openai.com') ||
    host.endsWith('.openai.azure.com') ||
    host.includes('openai.azure.com')
  );
}

/** Heuristic: catalog / chat model id looks like an OpenAI-style image model. */
export function isOpenAIImageModelId(id: string): boolean {
  const v = (id || '').trim().toLowerCase();
  if (!v) return false;
  if (v.startsWith('dall-e') || v.includes('dall-e-')) return true;
  if (v.startsWith('gpt-image')) return true;
  return false;
}

/**
 * Infer OpenAI-compatible image-gen capability from the current chat provider.
 *
 * Preference order (first match wins):
 * 1. URL host looks like OpenAI / Azure OpenAI
 *    → capability with catalog image models, or `OPENAI_DEFAULT_IMAGE_MODELS`.
 * 2. Catalog lists OpenAI-style image models (`dall-e-*`, `gpt-image*`)
 *    → capability with those catalog models (gateway / proxy hosts).
 * 3. Otherwise → `null` (do not expose `generate_image`; provider likely chat-only).
 */
export function inferImageCapability(input: {
  baseURL: string;
  catalogModelIds?: string[];
  providerName?: string;
}): ImageCapability | null {
  const baseURL = (input.baseURL || '').trim();
  if (!baseURL) return null;

  const catalog = (input.catalogModelIds ?? []).map((id) => (id || '').trim()).filter(Boolean);
  const openaiCatalog = catalog.filter((id) => isOpenAIImageModelId(id));

  const looksOpenAI = isOpenAIImageHost(baseURL) || openaiCatalog.length > 0;
  if (!looksOpenAI) return null;

  const models =
    openaiCatalog.length > 0
      ? uniqueKeepOrder(openaiCatalog)
      : [...OPENAI_DEFAULT_IMAGE_MODELS];
  return {
    protocol: 'openai_images',
    models,
    defaultModel: models[0]!,
  };
}

function uniqueKeepOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const k = id.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** Map aspect_ratio onto a common OpenAI Images size. */
export function aspectRatioToOpenAISize(aspectRatio?: string): OpenAIImageSize {
  const a = (aspectRatio || '1:1').trim();
  if (a === '16:9' || a === '21:9' || a === '3:2' || a === '4:3') return '1792x1024';
  if (a === '9:16' || a === '2:3' || a === '3:4') return '1024x1792';
  return '1024x1024';
}

function normalizeOpenAISize(raw: string | undefined, aspectRatio?: string): OpenAIImageSize {
  const v = (raw || '').trim();
  if ((OPENAI_IMAGE_SIZES as readonly string[]).includes(v)) {
    return v as OpenAIImageSize;
  }
  return aspectRatioToOpenAISize(aspectRatio);
}

type OpenAIImagesResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string; type?: string; code?: string | number };
};

export function parseOpenAIImagesResponse(json: unknown): {
  base64?: string;
  url?: string;
  errorMessage?: string;
} {
  const body = (json && typeof json === 'object' ? json : {}) as OpenAIImagesResponse;
  const errMsg =
    typeof body.error?.message === 'string' && body.error.message.trim()
      ? body.error.message.trim()
      : undefined;
  const first = Array.isArray(body.data) ? body.data[0] : undefined;
  const b64 = first?.b64_json;
  const url = first?.url;
  return {
    base64: typeof b64 === 'string' && b64.trim() ? b64.trim() : undefined,
    url: typeof url === 'string' && url.trim() ? url.trim() : undefined,
    errorMessage: errMsg,
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

const MAX_GENERATED_IMAGE_DOWNLOAD_BYTES = 20 * 1024 * 1024;

async function decodeImageBytes(
  parsed: { base64?: string; url?: string },
  opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<Buffer> {
  if (parsed.base64) {
    return Buffer.from(stripDataUrlPrefix(parsed.base64), 'base64');
  }
  if (parsed.url) {
    const fetchImpl = opts?.fetchImpl ?? fetch;
    const timeout = AbortSignal.timeout(30_000);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const res = await fetchImpl(parsed.url, { signal });
    if (!res.ok) {
      throw new Error(`下载生成图片失败：HTTP ${res.status}`);
    }
    const declared = Number(res.headers.get('content-length') || '0');
    if (Number.isFinite(declared) && declared > MAX_GENERATED_IMAGE_DOWNLOAD_BYTES) {
      throw new Error(`下载生成图片过大（Content-Length ${declared}）`);
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_GENERATED_IMAGE_DOWNLOAD_BYTES) {
      throw new Error(`下载生成图片过大（${ab.byteLength} 字节）`);
    }
    return Buffer.from(ab);
  }
  throw new Error('响应中没有可用的图片数据（base64 / url）');
}

async function saveImageBytes(
  bytes: Buffer,
  opts: { ownerId: string; resourcesDir: string },
  prompt: string,
  meta: { endpoint: string; model: string; protocol: ImageProtocol },
): Promise<GenerateImageResult> {
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
    endpoint: meta.endpoint,
    model: meta.model,
    protocol: meta.protocol,
  };
}

export type GenerateImageSaveOpts = {
  fetchImpl?: typeof fetch;
  /** Absolute directory to write into (`~/.okbot/<ownerId>/resources`). */
  resourcesDir: string;
  /** Bot or squad id; used in markdown `okbot-asset:<ownerId>/resources/…`. */
  ownerId: string;
  /** Pre-inferred capability; when omitted, inferred from credentials. */
  capability?: ImageCapability | null;
  /** Run abort (Stop / steer). Download and the generations POST honor it. */
  signal?: AbortSignal;
};

/**
 * Call OpenAI-compatible `POST {baseURL}/images/generations` (Bearer),
 * accept `b64_json` / `url` in `data[]`, save under owner `resources/`.
 */
export async function generateImage(
  creds: ImageApiCredentials,
  input: GenerateImageInput,
  opts: GenerateImageSaveOpts,
): Promise<GenerateImageResult> {
  const capability =
    opts.capability !== undefined
      ? opts.capability
      : inferImageCapability({
          baseURL: creds.baseURL,
          catalogModelIds: creds.catalogModelIds,
          providerName: creds.providerName,
        });

  if (!capability) {
    throw new Error(
      '当前模型供应商不支持文生图（未识别为 OpenAI 兼容图片接口）。请使用 OpenAI，或在供应商模型列表中加入 dall-e / gpt-image 等文生图模型。',
    );
  }

  const prompt = (input.prompt || '').trim();
  if (!prompt) throw new Error('prompt 不能为空');
  if (prompt.length > 4000) throw new Error('prompt 最长 4000 字符');

  const apiKey = (creds.apiKey || '').trim();
  if (!apiKey) throw new Error('API Key 为空，请先在设置里配置模型供应商');

  const defaultModel = capability.defaultModel || OPENAI_DEFAULT_IMAGE_MODELS[0];
  const model = (input.model || '').trim() || defaultModel;
  const size = normalizeOpenAISize(input.size, input.aspectRatio);
  const endpoint = openAIImageGenerationsUrl(creds.baseURL);
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(120_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json',
    }),
    signal,
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

  if (res.status === 404) {
    throw new Error(
      '图片生成接口不存在（HTTP 404）。当前供应商可能不支持 OpenAI 兼容的 /images/generations，请换用支持文生图的供应商（如 OpenAI）。',
    );
  }

  const parsed = parseOpenAIImagesResponse(json);
  if (!res.ok) {
    throw new Error(
      `图片生成失败（HTTP ${res.status}）：${parsed.errorMessage || rawText.slice(0, 400)}`,
    );
  }
  if (parsed.errorMessage && !parsed.base64 && !parsed.url) {
    throw new Error(`图片生成失败：${parsed.errorMessage}`);
  }

  const bytes = await decodeImageBytes(parsed, { signal: opts.signal, fetchImpl });
  return saveImageBytes(bytes, opts, prompt, {
    endpoint,
    model,
    protocol: 'openai_images',
  });
}

export function formatGenerateImageToolOutput(result: GenerateImageResult): string {
  return [
    '图片已生成并保存到本机。',
    `protocol: ${result.protocol}`,
    `endpoint: ${result.endpoint}`,
    `model: ${result.model}`,
    `path: ${result.filePath}`,
    `asset: ${result.assetRel}`,
    '',
    '请把下面这一行 markdown **原样**写入你的回复（不要改 src），用户气泡才能内嵌显示图片：',
    result.markdown,
  ].join('\n');
}
