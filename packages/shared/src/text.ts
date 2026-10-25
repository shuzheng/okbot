/** Text / think-tag / token-estimate / redact helpers. */

/** Rough chars→tokens for CJK-heavy chat (conservative). */
export const CHARS_PER_TOKEN_ESTIMATE = 2;

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  // Mixed heuristic: CJK-ish ~2 chars/token; Latin-heavy ~4 chars/token.
  // Pure length/2 overestimated English by ~2× and triggered compress too early.
  let cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0x3400 && c <= 0x9fff) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0xac00 && c <= 0xd7af)
    ) {
      cjk += 1;
    }
  }
  const latin = Math.max(0, text.length - cjk);
  return Math.max(1, Math.ceil(cjk / 2 + latin / 4));
}

/** Open/close tags MiniMax-style models emit for chain-of-thought. */
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

export type ThinkParseResult = {
  /** Trimmed thinking segments in order (finished and unfinished open tags). */
  thinking: string[];
  /** Text outside think tags (leading/trailing newlines from tag removal cleaned). */
  answer: string;
  /** True when at least one `<think>` open tag was present. */
  hasThinking: boolean;
};

/**
 * Longest proper prefix of THINK_OPEN / THINK_CLOSE at the end of `text`.
 * Used while streaming so partial tags (`<think`, `</th`, …) never paint into the
 * visible answer (or thinking body) before the tag completes — that flash-then-vanish
 * was the reply-bubble bug.
 */
export function trailingThinkTagPrefix(text: string): string {
  if (!text) return '';
  const max = Math.max(THINK_OPEN.length, THINK_CLOSE.length) - 1;
  const limit = Math.min(text.length, max);
  for (let len = limit; len >= 1; len--) {
    const suf = text.slice(-len);
    if (
      (THINK_OPEN.startsWith(suf) && suf !== THINK_OPEN) ||
      (THINK_CLOSE.startsWith(suf) && suf !== THINK_CLOSE)
    ) {
      return suf;
    }
  }
  return '';
}

function holdTrailingThinkTagPrefix(text: string): { visible: string; held: string } {
  const held = trailingThinkTagPrefix(text);
  if (!held) return { visible: text, held: '' };
  return { visible: text.slice(0, -held.length), held };
}

/**
 * Best-effort parse of `<think>…</think>` spans (multiple + unfinished open while streaming).
 * Skips fenced code blocks (``` / ~~~) so literal tags in examples stay in the answer.
 * Unclosed open tags always consume the rest as thinking (stream + finalize) so raw tags
 * never flash in the main reply bubble; incomplete tag suffixes are held back until the
 * tag completes.
 * Nested/malformed tags are not specially handled; never throws.
 */
export function parseThinkContent(text: string): ThinkParseResult {
  if (!text) {
    return { thinking: [], answer: '', hasThinking: false };
  }

  // Hold incomplete `<think` / `</think` suffixes before any other work so a mid-stream
  // prefix cannot land in the answer channel (includes(THINK_OPEN) is false for `<think`).
  const { visible: rawVisible } = holdTrailingThinkTagPrefix(text);
  if (!rawVisible) {
    return { thinking: [], answer: '', hasThinking: false };
  }

  if (!rawVisible.includes(THINK_OPEN)) {
    return { thinking: [], answer: rawVisible, hasThinking: false };
  }

  // Mask fenced regions so indexOf never matches tags inside ``` / ~~~ blocks.
  const masked = rawVisible.split('');
  const n = rawVisible.length;
  let p = 0;
  while (p < n) {
    const fence = rawVisible.startsWith('```', p) ? '```' : rawVisible.startsWith('~~~', p) ? '~~~' : null;
    if (!fence) {
      p += 1;
      continue;
    }
    const openEnd = rawVisible.indexOf('\n', p);
    const contentStart = openEnd < 0 ? n : openEnd + 1;
    let close = -1;
    let q = contentStart;
    while (q < n) {
      const lineStart = q;
      const lineEnd = rawVisible.indexOf('\n', q);
      const end = lineEnd < 0 ? n : lineEnd;
      const line = rawVisible.slice(lineStart, end);
      if (line.trimStart().startsWith(fence)) {
        close = lineStart;
        break;
      }
      q = end < n ? end + 1 : n;
    }
    const maskUntil = close < 0 ? n : Math.min(n, close + fence.length);
    for (let k = p; k < maskUntil; k++) masked[k] = ' ';
    p = maskUntil;
  }
  const scan = masked.join('');

  const thinking: string[] = [];
  let answer = '';
  let i = 0;
  let hasThinking = false;
  while (i < rawVisible.length) {
    const openIdx = scan.indexOf(THINK_OPEN, i);
    if (openIdx < 0) {
      answer += rawVisible.slice(i);
      break;
    }
    answer += rawVisible.slice(i, openIdx);
    const contentStart = openIdx + THINK_OPEN.length;
    const closeIdx = scan.indexOf(THINK_CLOSE, contentStart);
    if (closeIdx < 0) {
      // Unclosed `<think>`: always treat remainder as thinking so the raw open tag and
      // body never paint into the main bubble (stream or truncated finalize).
      hasThinking = true;
      const partial = holdTrailingThinkTagPrefix(rawVisible.slice(contentStart)).visible.trim();
      if (partial) thinking.push(partial);
      break;
    }
    hasThinking = true;
    const segment = rawVisible.slice(contentStart, closeIdx).trim();
    if (segment) thinking.push(segment);
    i = closeIdx + THINK_CLOSE.length;
  }
  answer = answer.replace(/^\n+/, '').replace(/\n+$/, '');
  return { thinking, answer, hasThinking };
}

/** Remove all think spans; return answer-only text. */
export function stripThinkContent(text: string): string {
  return parseThinkContent(text).answer;
}

/** When showThinking is false, strip think spans; otherwise return text unchanged. */
export function applyShowThinkingToContent(text: string, showThinking: boolean): string {
  if (showThinking) return text;
  return stripThinkContent(text);
}

/**
 * Redact API keys / Bearer tokens from error strings before persist / toast / traces.
 * Mirrors testConnection; safe to run on already-redacted text.
 * @param maxLen Cap length after redaction (default 500). Pass a smaller value for UI toasts.
 */
export function redactSensitiveText(msg: string, apiKey?: string, maxLen = 500): string {
  let s = String(msg ?? '');
  const key = (apiKey || '').trim();
  if (key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(escaped, 'g'), '***');
  }
  s = s.replace(/Bearer\s+\S+/gi, 'Bearer ***');
  s = s.replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-***');
  s = s.replace(/sk-or-[A-Za-z0-9_\-]{8,}/g, 'sk-or-***');
  s = s.replace(/key-[A-Za-z0-9_\-]{8,}/g, 'key-***');
  const lim = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 500;
  return s.slice(0, lim);
}

/**
 * Strip `<think>` from assistant-role AgentInputItem-like objects (model / prompt-context).
 * Preserves shape (string content or Responses-style text parts). Non-assistant items unchanged.
 * Does not mutate `item`.
 */

/**
 * Drop JSON `null` values from tool-call `arguments` / `params` (string or object).
 * Strict gateways (e.g. MiniMax 400/2013) reject history that still carries
 * `"timezone":null` / `"job_id":null` from models that fill every optional key.
 * Does not mutate `item`; returns the same reference when nothing changes.
 */
export function sanitizeNullsInToolCallArguments<T extends Record<string, unknown>>(item: T): T {
  const typ = typeof item.type === 'string' ? item.type : '';
  if (typ !== 'function_call' && typ !== 'hosted_tool_call' && typ !== 'tool_call') return item;

  const argsKey: 'arguments' | 'params' =
    item.arguments !== undefined && item.arguments !== null
      ? 'arguments'
      : item.params !== undefined
        ? 'params'
        : 'arguments';

  let removed = false;
  const stripNulls = (value: unknown): unknown => {
    if (value === null) {
      removed = true;
      return undefined;
    }
    if (Array.isArray(value)) {
      const next = value.map(stripNulls).filter((v) => v !== undefined);
      if (next.length !== value.length) removed = true;
      return next;
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const next = stripNulls(v);
        // `removed` is set inside stripNulls when v === null; keep undefined keys out.
        if (next !== undefined) out[k] = next;
      }
      return out;
    }
    return value;
  };

  const rawArgs = item[argsKey];
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (!trimmed) return item;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      removed = false;
      const cleaned = stripNulls(parsed);
      if (cleaned === undefined || typeof cleaned !== 'object' || Array.isArray(cleaned)) {
        return item;
      }
      if (!removed) return item;
      return { ...item, [argsKey]: JSON.stringify(cleaned) };
    } catch {
      return item;
    }
  }
  if (rawArgs && typeof rawArgs === 'object') {
    removed = false;
    const cleaned = stripNulls(rawArgs);
    if (!removed) return item;
    if (cleaned === undefined || typeof cleaned !== 'object') return item;
    return { ...item, [argsKey]: cleaned };
  }
  return item;
}

export function stripThinkFromAgentInputItem<T extends Record<string, unknown>>(item: T): T {
  const role = typeof item.role === 'string' ? item.role : '';
  if (role !== 'assistant') return item;

  const content = item.content;
  if (typeof content === 'string') {
    const next = stripThinkContent(content);
    if (next === content) return item;
    return { ...item, content: next };
  }
  if (Array.isArray(content)) {
    let changed = false;
    const next = content.map((part) => {
      if (typeof part === 'string') {
        const stripped = stripThinkContent(part);
        if (stripped !== part) changed = true;
        return stripped;
      }
      if (!part || typeof part !== 'object') return part;
      const p = part as Record<string, unknown>;
      if (typeof p.text === 'string') {
        const stripped = stripThinkContent(p.text);
        if (stripped !== p.text) {
          changed = true;
          return { ...p, text: stripped };
        }
      }
      if (typeof p.refusal === 'string') {
        const stripped = stripThinkContent(p.refusal);
        if (stripped !== p.refusal) {
          changed = true;
          return { ...p, refusal: stripped };
        }
      }
      return part;
    });
    if (!changed) return item;
    return { ...item, content: next };
  }
  return item;
}

function contentPartsToPlainText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const chunks: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      chunks.push(part);
      continue;
    }
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (typeof p.text === 'string') chunks.push(p.text);
    else if (typeof p.refusal === 'string') chunks.push(p.refusal);
  }
  return chunks.join('');
}

/**
 * Coerce session / UI AgentInputItem shapes into the Responses-style ModelItem
 * forms that `RunState.toJSON` / `toString` validate (checkpoint + HITL resume).
 *
 * Plain UI assistants (`legacyMessageToRecord`, send_message bubbles) store
 * `content` as a string with no `status`. When Session history is folded into
 * `originalInput`, those items fail SDK serialization (`invalid_union` on
 * originalInput). Soft-steer restart and quote/vision sessionInputCallbacks
 * amplify this by returning the full history as prepared input.
 *
 * Does not mutate `item`; returns the same reference when nothing changes.
 * Disk / UI heuristics (`isPlainUiAssistantItem`) keep the raw string form.
 */
export function normalizeAgentInputItemForRunState<T extends Record<string, unknown>>(item: T): T {
  const role = typeof item.role === 'string' ? item.role : '';
  const typ = typeof item.type === 'string' ? item.type : '';
  const isMessage = typ === '' || typ === 'message';

  if (role === 'assistant' && isMessage) {
    let next: Record<string, unknown> = item;
    let changed = false;
    const content = next.content;
    if (typeof content === 'string') {
      next = { ...next, content: [{ type: 'output_text', text: content }] };
      changed = true;
    } else if (Array.isArray(content)) {
      let partsChanged = false;
      const parts = content.map((part) => {
        if (typeof part === 'string') {
          partsChanged = true;
          return { type: 'output_text', text: part };
        }
        return part;
      });
      if (partsChanged) {
        next = changed ? { ...next, content: parts } : { ...item, content: parts };
        changed = true;
      }
    }
    const status = next.status;
    if (status !== 'in_progress' && status !== 'completed' && status !== 'incomplete') {
      next = changed ? { ...next, status: 'completed' } : { ...item, status: 'completed' };
      changed = true;
    }
    return changed ? (next as T) : item;
  }

  if (typ === 'reasoning') {
    const content = item.content;
    if (typeof content === 'string') {
      return { ...item, content: [{ type: 'input_text', text: content }] } as T;
    }
    if (Array.isArray(content)) {
      let partsChanged = false;
      const parts = content.map((part) => {
        if (typeof part === 'string') {
          partsChanged = true;
          return { type: 'input_text', text: part };
        }
        return part;
      });
      if (partsChanged) return { ...item, content: parts } as T;
    }
    return item;
  }

  if (role === 'system' && isMessage && Array.isArray(item.content)) {
    return { ...item, content: contentPartsToPlainText(item.content) } as T;
  }

  return item;
}

/** True for AbortSignal / fetch / SDK aborts (steer, Stop, duration breaker). */
export function isAbortLikeError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return true;
    const msg = String(e.message ?? '');
    if (
      /request was aborted/i.test(msg) ||
      /this operation was aborted/i.test(msg) ||
      /the operation was aborted/i.test(msg) ||
      /aborted without reason/i.test(msg)
    ) {
      return true;
    }
    if (e.cause != null && e.cause !== err) return isAbortLikeError(e.cause);
  }
  if (typeof err === 'string') {
    return (
      /request was aborted/i.test(err) ||
      /this operation was aborted/i.test(err) ||
      /the operation was aborted/i.test(err)
    );
  }
  return false;
}

export function formatUserTextWithQuote(body: string, quotedContent: string): string {
  const q = quotedContent.replace(/\r\n/g, '\n').trim();
  const b = body.replace(/\r\n/g, '\n').trim();
  if (!q) return b;
  if (!b) return `引用：\n${q}`;
  return `引用：\n${q}\n\n${b}`;
}

/** Clamp quote preview for composer / bubble strip (plain text, ~2 lines). */
export function clipQuotePreview(raw: string, maxChars = 160): string {
  const plain = plainTextFromMarkdown(raw || '').replace(/\s+/g, ' ').trim();
  if (plain.length <= maxChars) return plain;
  return `${plain.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** Strip common Markdown so sidebar previews stay readable as plain text. */
export function plainTextFromMarkdown(input: string): string {
  let s = input.replace(/\r\n/g, '\n');
  // Fenced code → keep a short plain hint
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) => {
    const line = String(code).trim().split('\n').find((l) => l.trim()) || '';
    return line ? line.trim() : '';
  });
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^>\s?/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  s = s.replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, '$2');
  s = s.replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2');
  s = s.replace(/~~(\S(?:.*?\S)?)~~/g, '$1');
  s = s.replace(/^\|?\s*[-:| ]+\|?\s*$/gm, '');
  s = s.replace(/\|/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}


export function createId(prefix: string): string {
  const id =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}_${id}`;
}

/**
 * Drop a leading copy of sealed mesh interim A from follow-up B when the model
 * repeats pre-tool narration after ask_assistant.
 */
export function stripLeadingCommittedInterim(
  content: string,
  interim: string | undefined | null,
): string {
  if (!content) return content;
  const prefix = (interim || '').trimEnd();
  if (!prefix) return content;

  if (content.startsWith(prefix)) {
    return content.slice(prefix.length).replace(/^[ \t]+/, '').replace(/^\r?\n/, '');
  }

  const trimmed = content.trimStart();
  const p = prefix.trim();
  if (p && trimmed.startsWith(p)) {
    const idx = content.indexOf(p);
    if (idx >= 0) {
      return content.slice(idx + p.length).replace(/^[ \t]+/, '').replace(/^\r?\n/, '');
    }
  }

  const body = content.trim();
  if (body && prefix.startsWith(body)) {
    return '';
  }

  return content;
}

/**
 * Strip user-facing boilerplate that leaks internal storage (`resources/…`,
 * 「工作空间」paths). Keeps markdown image lines intact.
 */
export function stripInternalImageStorageHints(content: string): string {
  if (!content) return content;
  const lines = content.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      kept.push(line);
      continue;
    }
    if (/^(原图)?保存在工作空间\s*[:：]/u.test(t)) continue;
    if (/^原图保存(在|至|到)/u.test(t) && /resources\//i.test(t)) continue;
    if (/^(图片)?已保存(在|至|到).*(工作空间|resources\/)/u.test(t)) continue;
    if (/^(saved\s+to\s+)?workspace\s*[:：]/i.test(t)) continue;
    if (/^asset\s*:\s*\S+\/resources\//i.test(t)) continue;
    if (/^本机(路径|文件)\s*[:：]/u.test(t)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

