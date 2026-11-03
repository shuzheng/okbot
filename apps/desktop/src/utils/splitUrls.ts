/**
 * Split plain text into literal runs and bare http(s) URLs for chat rendering.
 * Trailing sentence punctuation is kept outside the URL when possible.
 */

export type UrlTextSeg =
  | { kind: 'text'; text: string }
  | { kind: 'url'; href: string; text: string };

const BARE_URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

function splitTrailingPunct(raw: string): { href: string; trailing: string } {
  let href = raw;
  let trailing = '';
  // Peel common trailing punctuation (keep balanced ) inside URLs).
  while (href.length > 0) {
    const last = href[href.length - 1]!;
    if (/[.,;:!?，。；：！？]/.test(last)) {
      trailing = last + trailing;
      href = href.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (href.match(/\(/g) || []).length;
      const closes = (href.match(/\)/g) || []).length;
      if (closes > opens) {
        trailing = last + trailing;
        href = href.slice(0, -1);
        continue;
      }
    }
    if (last === ']' || last === '}') {
      trailing = last + trailing;
      href = href.slice(0, -1);
      continue;
    }
    break;
  }
  return { href, trailing };
}

/** Split `text` into plain runs and http(s) URL segments (in order). */
export function splitUrls(text: string): UrlTextSeg[] {
  if (!text) return [];
  const out: UrlTextSeg[] = [];
  let last = 0;
  BARE_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_URL_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'text', text: text.slice(last, m.index) });
    }
    const { href, trailing } = splitTrailingPunct(m[0]);
    if (href) out.push({ kind: 'url', href, text: href });
    if (trailing) out.push({ kind: 'text', text: trailing });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.length ? out : [{ kind: 'text', text }];
}

export function isHttpUrl(href: string | undefined | null): boolean {
  return !!href && /^https?:\/\//i.test(href);
}
