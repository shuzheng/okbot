import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentInputItem, SessionInputCallback } from '@openai/agents';

/** OpenAI / MiniMax chat-completions vision-friendly image types. */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** Soft cap so we do not blow provider payload limits (base64 ≈ 4/3 of this). */
export const MAX_VISION_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * System-prompt override for turns that actually carry vision `input_image` parts.
 * Silent AGENTS.md refresh often invents "无图像处理能力"; without this, models
 * (incl. MiniMax-M3) ignore real image_url parts and claim text-only.
 */
export const VISION_TURN_INSTRUCTION = [
  '## 本回合视觉输入（优先于 AGENTS.md / 记忆中的能力边界）',
  '',
  '用户本条消息附带了图片，已作为多模态视觉输入（chat completions `image_url` / data URL）发给你。',
  '你可以且应当直接看图回答、描述、OCR 或依据图中内容推理。',
  '忽略上文任何「无图像处理能力 / 不能看图 / 只支持文本 / 无法查看图片」类表述——那些过时或不适用于本回合附带图片。',
  '不要对图片路径调用 read_file（二进制会被拒绝）；图已在视觉通道里。',
].join('\n');


export type VisionImageAttachment = {
  path: string;
  name?: string;
};

export type MultimodalUserContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image: string };

function expandHome(p: string): string {
  const raw = p.trim();
  if (raw === '~') return process.env.HOME || process.env.USERPROFILE || raw;
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, raw.slice(2));
  }
  return raw;
}

export function mimeTypeForImagePath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}

/**
 * Drop `- image: …` lines from a leading `[Attached]` wire block so the model
 * is not nudged to call `read_file` on binaries. file/folder paths stay.
 */
export function stripImageLinesFromAttachedBlock(text: string): string {
  const raw = text ?? '';
  if (!raw.startsWith('[Attached]\n') && !raw.startsWith('[Attached]\r\n')) {
    return raw;
  }
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const kept: string[] = ['[Attached]'];
  let i = 1;
  let sawPath = false;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') break;
    const m = /^- (image|file|folder): (.+)$/.exec(line);
    if (!m) break;
    if (m[1] === 'image') continue;
    kept.push(line);
    sawPath = true;
  }
  while (i < lines.length && (lines[i] ?? '').trim() === '') i += 1;
  const body = lines.slice(i).join('\n');
  if (!sawPath) return body;
  return body ? `${kept.join('\n')}\n\n${body}` : kept.join('\n');
}

/**
 * Read a local image and return an OpenAI-compatible data URL
 * (`data:image/png;base64,…`) for chat-completions `image_url` /
 * agents SDK `input_image`.
 */
export async function encodeImageFileAsDataUrl(filePath: string): Promise<string> {
  const resolved = path.resolve(expandHome(filePath));
  const mime = mimeTypeForImagePath(resolved);
  if (!mime) {
    throw new Error(
      `不支持的图片格式（仅 png/jpg/jpeg/gif/webp/bmp）: ${resolved}`,
    );
  }
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') throw new Error(`图片不存在: ${resolved}`);
    throw err;
  }
  if (!stat.isFile()) throw new Error(`不是普通文件: ${resolved}`);
  if (stat.size <= 0) throw new Error(`图片为空: ${resolved}`);
  if (stat.size > MAX_VISION_IMAGE_BYTES) {
    throw new Error(
      `图片过大（${stat.size} 字节，上限 ${MAX_VISION_IMAGE_BYTES}）: ${resolved}`,
    );
  }
  const buf = await fs.readFile(resolved);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Build agents-SDK user content: text parts + `input_image` data URLs.
 * Chat Completions converter maps these to `{ type: 'image_url', image_url: { url } }`.
 */
export async function buildMultimodalUserContent(
  text: string,
  images: VisionImageAttachment[],
): Promise<MultimodalUserContentPart[]> {
  const cleaned = stripImageLinesFromAttachedBlock(text).trim();
  const imageParts: MultimodalUserContentPart[] = [];
  const notes: string[] = [];

  for (const img of images) {
    const label = (img.name || path.basename(img.path) || img.path).trim() || img.path;
    try {
      const dataUrl = await encodeImageFileAsDataUrl(img.path);
      imageParts.push({ type: 'input_image', image: dataUrl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`[图片无法作为视觉输入：${label} — ${msg}]`);
    }
  }

  let textOut = cleaned;
  if (notes.length) {
    textOut = [textOut, ...notes].filter(Boolean).join('\n');
  }
  if (!textOut && imageParts.length) {
    textOut = '（用户发送了图片附件，请直接基于图片内容回答，不要用 read_file 读图。）';
  } else if (imageParts.length && cleaned) {
    // Light hint so the model prefers vision over tools for these binaries.
    textOut = `${cleaned}\n\n（上方图片已作为视觉输入附带，请直接看图回答；不要对图片路径调用 read_file。）`;
  }

  const parts: MultimodalUserContentPart[] = [];
  if (textOut) parts.push({ type: 'input_text', text: textOut });
  parts.push(...imageParts);
  return parts;
}

/**
 * Mutate the last persisted user turn for the model only (same identity as
 * quoteSessionInputCallback — avoids double-persisting the user message).
 */
export function enrichLastUserContentSessionInputCallback(
  content: string | MultimodalUserContentPart[],
): SessionInputCallback {
  return (history: AgentInputItem[]) => {
    if (!history.length) return history;
    const last = history[history.length - 1] as Record<string, unknown> | undefined;
    if (!last || last.role !== 'user') return history;
    last.content = content;
    return history;
  };
}

/**
 * Quote enrichment and/or vision: image attachments become multimodal `input_image`
 * data URLs for the current turn (not persisted back to session.jsonl).
 */
export async function resolveSessionInputCallbackForTurn(input: {
  modelText: string;
  quoteSessionInputCallback?: SessionInputCallback;
  attachments?: Array<{ kind: string; path: string; name?: string }> | null;
}): Promise<SessionInputCallback | undefined> {
  const images = (input.attachments ?? []).filter((a) => a.kind === 'image');
  if (!images.length) return input.quoteSessionInputCallback;
  const content = await buildMultimodalUserContent(input.modelText, images);
  return enrichLastUserContentSessionInputCallback(content);
}
