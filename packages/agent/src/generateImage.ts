import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { stripInternalImageStorageHints } from '@okbot/shared';

/** MiniMax native image models (not OpenAI /v1/images/generations). */
export const MINIMAX_IMAGE_MODELS = ['image-01', 'image-01-live'] as const;
export type MinimaxImageModel = (typeof MINIMAX_IMAGE_MODELS)[number];

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
/** @deprecated alias */
export type MinimaxAspectRatio = ImageAspectRatio;

/** Common OpenAI Images API sizes. */
export const OPENAI_IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const;
export type OpenAIImageSize = (typeof OPENAI_IMAGE_SIZES)[number];

/** Default OpenAI-style image models when host is OpenAI but catalog has none. */
export const OPENAI_DEFAULT_IMAGE_MODELS = ['dall-e-3', 'dall-e-2', 'gpt-image-1'] as const;

/** Legacy markdown scheme (pre-/v1/media). Still accepted when reading old replies. */
export const OKBOT_ASSET_SCHEME = 'okbot-asset:';

/** Absolute gateway media path prefix used in reply markdown (`/v1/media/<owner>/resources/<file>`). */
export const GATEWAY_MEDIA_PATH_PREFIX = '/v1/media/';

export type ImageProtocol = 'minimax' | 'openai_images';

/**
 * Inferred image-gen capability for the current chat provider.
 * Used to pick MiniMax vs OpenAI adapters and default models.
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
  /** Provider catalog model ids (optional; helps infer OpenAI/MiniMax image models). */
  catalogModelIds?: string[];
  /** Provider display name (optional MiniMax hint). */
  providerName?: string;
};

export type GenerateImageInput = {
  prompt: string;
  aspectRatio?: string;
  model?: string;
  /** OpenAI Images `size` when protocol is openai_images (overrides aspectRatio mapping). */
  size?: string;
};

export type GenerateImageResult = {
  /** Absolute path on disk. */
  filePath: string;
  /** Relative path under ~/.okbot (e.g. <ownerId>/resources/xxx.png). */
  assetRel: string;
  /** Absolute gateway path for markdown img src (`/v1/media/<owner>/resources/…`). */
  markdownSrc: string;
  /** Full markdown image line for the model to paste into the reply. */
  markdown: string;
  endpoint: string;
  model: string;
  protocol: ImageProtocol;
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

export function mediaGatewayPathname(assetRel: string): string | null {
  const rel = (assetRel || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!rel || rel.includes('..') || rel.startsWith('/')) return null;
  const parts = rel.split('/');
  if (parts.length !== 3 || parts[1] !== 'resources') return null;
  const ownerId = parts[0] || '';
  const fileName = parts[2] || '';
  if (!ownerId || !fileName) return null;
  if (ownerId.includes('\\') || fileName.includes('\\')) return null;
  if (ownerId.includes('\0') || fileName.includes('\0')) return null;
  return `${GATEWAY_MEDIA_PATH_PREFIX}${encodeURIComponent(ownerId)}/resources/${encodeURIComponent(fileName)}`;
}

/** Markdown img src for generate_image: absolute gateway `/v1/media/…` path. */
export function okbotAssetMarkdownSrc(assetRel: string): string {
  const pathname = mediaGatewayPathname(assetRel);
  if (!pathname) throw new Error(`非法 assetRel：${assetRel}`);
  return pathname;
}

function assetRelFromOwnerResources(ownerId: string, fileName: string): {
  assetRel: string;
  ownerId: string;
  fileName: string;
} | null {
  const id = (ownerId || '').trim();
  const name = (fileName || '').trim();
  if (!id || !name) return null;
  if (id.includes('..') || name.includes('..')) return null;
  if (id.includes('/') || name.includes('/') || id.includes('\\') || name.includes('\\')) return null;
  return { assetRel: `${id}/resources/${name}`, ownerId: id, fileName: name };
}

/**
 * Parse a markdown/img src into `<ownerId>/resources/<file>` when it points at
 * gateway /v1/media, legacy okbot-asset:, or file://…/.okbot/…/resources/.
 */
export function parseOwnerResourceMarkdownSrc(src: string | undefined): {
  assetRel: string;
  ownerId: string;
  fileName: string;
} | null {
  if (!src || typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!trimmed) return null;

  const fromMediaPathname = (pathname: string) => {
    const pathOnly = pathname.split('?')[0]!.split('#')[0]!;
    const m = /^\/v1\/media\/([^/]+)\/resources\/([^/]+)$/i.exec(pathOnly);
    if (!m?.[1] || !m?.[2]) return null;
    let ownerId = m[1];
    let fileName = m[2];
    try {
      ownerId = decodeURIComponent(ownerId);
      fileName = decodeURIComponent(fileName);
    } catch {
      /* keep encoded */
    }
    return assetRelFromOwnerResources(ownerId, fileName);
  };

  if (/^\/v1\/media\//i.test(trimmed)) {
    return fromMediaPathname(trimmed);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      return fromMediaPathname(u.pathname || '');
    } catch {
      return null;
    }
  }

  if (/^okbot-asset:/i.test(trimmed)) {
    const rel = trimmed
      .replace(/^okbot-asset:/i, '')
      .replace(/^\/+/, '')
      .replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts.length !== 3 || parts[1] !== 'resources') return null;
    return assetRelFromOwnerResources(parts[0] || '', parts[2] || '');
  }

  let pathPart = trimmed;
  if (/^file:/i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      pathPart = decodeURIComponent(u.pathname || '');
    } catch {
      pathPart = trimmed.replace(/^file:\/\//i, '');
      try {
        pathPart = decodeURIComponent(pathPart);
      } catch {
        /* keep raw */
      }
    }
  }

  const m = /(?:^|[\\/])\.okbot[\\/]([^/\\]+)[\\/]resources[\\/]([^/\\?#]+)/i.exec(
    pathPart.replace(/\\/g, '/'),
  );
  if (!m?.[1] || !m?.[2]) return null;
  return assetRelFromOwnerResources(m[1], m[2]);
}

/** Rewrite legacy okbot-asset: / file://…/.okbot/…/resources/ (and keep /v1/media) to gateway path. */
export function normalizeMediaMarkdownSrc(src: string): string | null {
  const parsed = parseOwnerResourceMarkdownSrc(src);
  if (!parsed) return null;
  return mediaGatewayPathname(parsed.assetRel);
}

/**
 * On persist: rewrite reply markdown image srcs to absolute gateway `/v1/media/…`.
 * Leaves data: / https / unknown srcs unchanged (tool copy forbids emitting them).
 */
export function normalizeReplyMediaMarkdown(content: string): string {
  if (!content) return content;
  let out = content;
  if (out.includes('](')) {
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (full, alt: string, src: string) => {
      const next = normalizeMediaMarkdownSrc(src);
      if (!next || next === src) return full;
      return `![${alt}](${next})`;
    });
  }
  return stripInternalImageStorageHints(out);
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

/** Host looks like MiniMax official / regional APIs. */
export function isMinimaxImageHost(baseURL: string): boolean {
  const host = hostnameOf(baseURL);
  if (host.includes('minimax')) return true;
  const nameHint = (baseURL || '').toLowerCase();
  return !host && /minimax/i.test(nameHint);
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

export function isMinimaxImageModelId(id: string): boolean {
  const v = (id || '').trim().toLowerCase();
  return (MINIMAX_IMAGE_MODELS as readonly string[]).includes(v) || v === 'image-01' || v.startsWith('image-01');
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
 * Infer image-gen protocol from the current chat provider.
 *
 * Preference order (first match wins):
 * 1. URL host looks like MiniMax, OR provider name contains "minimax",
 *    OR catalog lists MiniMax image models (`image-01` / `image-01-live`)
 *    → MiniMax adapter (`POST {baseURL}/image_generation`).
 * 2. URL host looks like OpenAI / Azure OpenAI, OR catalog lists
 *    OpenAI-style image models (`dall-e-*`, `gpt-image*`)
 *    → OpenAI-compatible adapter (`POST {baseURL}/images/generations`).
 * 3. Otherwise → `null` (chat-only host; do not expose a working generate_image for this provider).
 *
 * Gateways that proxy MiniMax without "minimax" in the host are covered when
 * `image-01` appears in the provider catalog.
 */
export function inferImageCapability(input: {
  baseURL: string;
  catalogModelIds?: string[];
  providerName?: string;
}): ImageCapability | null {
  const baseURL = (input.baseURL || '').trim();
  if (!baseURL) return null;

  const catalog = (input.catalogModelIds ?? []).map((id) => (id || '').trim()).filter(Boolean);
  const name = (input.providerName || '').toLowerCase();
  const minimaxCatalog = catalog.filter((id) => isMinimaxImageModelId(id));
  const openaiCatalog = catalog.filter((id) => isOpenAIImageModelId(id));

  const looksMinimax =
    isMinimaxImageHost(baseURL) ||
    name.includes('minimax') ||
    minimaxCatalog.length > 0;

  if (looksMinimax) {
    const models =
      minimaxCatalog.length > 0
        ? uniqueKeepOrder([...minimaxCatalog, ...MINIMAX_IMAGE_MODELS])
        : [...MINIMAX_IMAGE_MODELS];
    return {
      protocol: 'minimax',
      models,
      defaultModel: models.includes('image-01') ? 'image-01' : models[0]!,
    };
  }

  const looksOpenAI = isOpenAIImageHost(baseURL) || openaiCatalog.length > 0;
  if (looksOpenAI) {
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

  return null;
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

function normalizeAspectRatio(raw: string | undefined): MinimaxAspectRatio {
  const v = (raw || '1:1').trim();
  if ((IMAGE_ASPECT_RATIOS as readonly string[]).includes(v)) {
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

/** Map MiniMax-style aspect_ratio onto a common OpenAI Images size. */
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

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
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
  // The owner folder must still exist: a deleted bot / squad is not recreated
  // by a late image (only `resources/` itself is created here).
  if (!(await isDir(path.dirname(resourcesDir)))) throw new Error('owner_deleted');
  try {
    await fs.mkdir(resourcesDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
  }
  await fs.writeFile(filePath, bytes, { flag: 'wx' });

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
  /** Bot or squad id; used in markdown `/v1/media/<ownerId>/resources/…`. */
  ownerId: string;
  /** Pre-inferred capability; when omitted, inferred from credentials. */
  capability?: ImageCapability | null;
  /** Run abort (Stop / steer). Download and the generations POST honor it. */
  signal?: AbortSignal;
};

/**
 * Call MiniMax-native `POST {baseURL}/image_generation`, save under the
 * owner `resources/` dir, return markdown the assistant must echo.
 */
/** Clear tool/user-facing error when no provider supports image gen. */
export const GENERATE_IMAGE_UNSUPPORTED_MESSAGE =
  '当前对话所用模型供应商不支持文生图（需 MiniMax 的 /image_generation，或 OpenAI 兼容 /images/generations；请把对话切到支持文生图的供应商，或在该供应商模型列表加入 image-01 / dall-e / gpt-image）。不要用 SVG、ASCII 画或 data:image 冒充。';

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
      aspect_ratio: aspectRatio,
      response_format: 'base64',
      n: 1,
      prompt_optimizer: true,
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
      '图片生成接口不存在（HTTP 404）。当前供应商可能不支持 MiniMax 原生 /image_generation。',
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

  const bytes = await decodeImageBytes(parsed, { signal: opts.signal, fetchImpl });
  return saveImageBytes(bytes, opts, prompt, {
    endpoint,
    model,
    protocol: 'minimax',
  });
}

/**
 * Call OpenAI-compatible `POST {baseURL}/images/generations` (Bearer),
 * accept `b64_json` / `url` in `data[]`, save under owner `resources/`.
 */
export async function generateImageWithOpenAI(
  creds: ImageApiCredentials,
  input: GenerateImageInput,
  opts: GenerateImageSaveOpts,
  capability?: ImageCapability | null,
): Promise<GenerateImageResult> {
  const prompt = (input.prompt || '').trim();
  if (!prompt) throw new Error('prompt 不能为空');
  if (prompt.length > 4000) throw new Error('prompt 最长 4000 字符');

  const apiKey = (creds.apiKey || '').trim();
  if (!apiKey) throw new Error('API Key 为空，请先在设置里配置模型供应商');

  const cap =
    capability ??
    inferImageCapability({
      baseURL: creds.baseURL,
      catalogModelIds: creds.catalogModelIds,
      providerName: creds.providerName,
    });
  const defaultModel = cap?.defaultModel || OPENAI_DEFAULT_IMAGE_MODELS[0];
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
      '图片生成接口不存在（HTTP 404）。当前供应商可能不支持 OpenAI 兼容的 /images/generations，请换用支持文生图的供应商（如 MiniMax 或 OpenAI）。',
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

/**
 * Dispatch to MiniMax or OpenAI-compatible adapter based on inferred capability.
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
    throw new Error(GENERATE_IMAGE_UNSUPPORTED_MESSAGE);
  }

  if (capability.protocol === 'minimax') {
    return generateImageWithMinimax(creds, input, { ...opts, capability });
  }
  return generateImageWithOpenAI(creds, input, { ...opts, capability }, capability);
}

export { stripInternalImageStorageHints };

/** Tool result text for the model — no workspace/asset paths (avoids echoing them to users). */
export function formatGenerateImageToolOutput(result: GenerateImageResult): string {
  return [
    '图片已生成。',
    '',
    '请把下面这一行 markdown **原样**写入你的回复（不要改 src；禁止改成 data:、file:// 或外链 https）。不要向用户提及本机路径、resources 目录、asset 相对路径，也不要写「原图保存在…」一类说明：',
    result.markdown,
    '',
    '禁止用 SVG / ASCII 画 / write_file 手绘 / data:image 冒充文生图结果。',
  ].join('\n');
}
