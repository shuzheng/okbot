import type { MessageAttachment } from '@okbot/shared';

function basenameOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) || norm : norm;
}

/** Build the `[Attached]` wire block (paths for tools/UI). Image binaries are also sent as vision `input_image` data URLs by the agent layer. */
export function formatAttachedBlock(atts: MessageAttachment[]): string {
  if (!atts.length) return '';
  return `[Attached]\n${atts.map((a) => `- ${a.kind}: ${a.path}`).join('\n')}`;
}

export function formatMessageWithAttachments(body: string, atts: MessageAttachment[]): string {
  const text = body.trim();
  const block = formatAttachedBlock(atts);
  if (!block) return text;
  return text ? `${block}\n\n${text}` : block;
}

/**
 * Split a stored user `content` that may start with `[Attached]\\n- kind: path…`.
 * Used for display (hide block from bubble) and as fallback when meta.attachments is missing.
 */
export function parseAttachedContent(content: string): {
  body: string;
  attachments: MessageAttachment[];
} {
  const raw = content ?? '';
  if (!raw.startsWith('[Attached]\n') && !raw.startsWith('[Attached]\r\n')) {
    return { body: raw, attachments: [] };
  }
  const rest = raw.replace(/^\[Attached\]\r?\n/, '');
  const lines = rest.split(/\r?\n/);
  const attachments: MessageAttachment[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') break;
    const m = /^- (image|file|folder): (.+)$/.exec(line);
    if (!m) break;
    const kind = m[1] as MessageAttachment['kind'];
    const path = m[2]!;
    attachments.push({ kind, path, name: basenameOf(path) });
  }
  while (i < lines.length && (lines[i] ?? '').trim() === '') i += 1;
  return { body: lines.slice(i).join('\n'), attachments };
}

/** Prefer structured meta attachments; always strip `[Attached]` from bubble body. */
export function resolveMessageAttachments(message: {
  content: string;
  attachments?: MessageAttachment[];
}): { body: string; attachments: MessageAttachment[] } {
  const parsed = parseAttachedContent(message.content || '');
  if (message.attachments?.length) {
    return { body: parsed.body, attachments: message.attachments };
  }
  return parsed;
}
