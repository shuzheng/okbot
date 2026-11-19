/**
 * Client theme hook for generated HTML notes.
 * The preview host stamps / updates `data-theme="light|dark"` on the note
 * document's `<html>` so pages can follow the OkBot in-app theme
 * (not only OS `prefers-color-scheme`, which can disagree on web).
 */
export type ClientTheme = 'light' | 'dark';

/** Resolved OkBot client theme from the parent document. */
export function resolvedClientTheme(): ClientTheme {
  if (typeof document === 'undefined') return 'dark';
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

/** Apply the resolved client theme onto a note document (live preview iframe). */
export function applyNoteDocumentTheme(doc: Document, theme: ClientTheme): void {
  const root = doc.documentElement;
  if (!root) return;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

/**
 * Stamp `data-theme` and `color-scheme` on the root `<html>` of a note
 * HTML string (chat-card capture, or first paint of a srcdoc preview).
 */
export function stampNoteHtmlTheme(html: string, theme: ClientTheme): string {
  if (!html) {
    return `<html data-theme="${theme}" style="color-scheme:${theme}"></html>`;
  }
  const htmlOpen = /<html\b([^>]*)>/i.exec(html);
  if (htmlOpen && htmlOpen.index != null) {
    const attrs = upsertStyleColorScheme(upsertHtmlAttr(htmlOpen[1] || '', 'data-theme', theme), theme);
    return `${html.slice(0, htmlOpen.index)}<html${attrs}>${html.slice(htmlOpen.index + htmlOpen[0].length)}`;
  }
  const doctype = /^(\s*<!DOCTYPE[^>]*>)/i.exec(html);
  if (doctype) {
    return `${doctype[1]}<html data-theme="${theme}" style="color-scheme:${theme}">${html.slice(doctype[0].length)}</html>`;
  }
  return `<html data-theme="${theme}" style="color-scheme:${theme}">${html}</html>`;
}

function upsertHtmlAttr(attrs: string, name: string, value: string): string {
  const assignment = ` ${name}="${value}"`;
  const quoted = new RegExp(`\\s*${name}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'i');
  if (quoted.test(attrs)) return attrs.replace(quoted, assignment);
  const unquoted = new RegExp(`\\s*${name}\\s*=\\s*[^\\s>]+`, 'i');
  if (unquoted.test(attrs)) return attrs.replace(unquoted, assignment);
  const bare = new RegExp(`\\s*${name}(?=[\\s>]|$)`, 'i');
  if (bare.test(attrs)) return attrs.replace(bare, assignment);
  return `${attrs}${assignment}`;
}

function upsertStyleColorScheme(attrs: string, theme: ClientTheme): string {
  const re = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i;
  const m = re.exec(attrs);
  const decl = `color-scheme:${theme}`;
  if (!m) return `${attrs} style="${decl}"`;
  const q = m[1];
  const cleaned = m[2].replace(/color-scheme\s*:\s*[^;]*;?/gi, '').trim().replace(/;+$/, '');
  const next = cleaned ? `${cleaned};${decl}` : decl;
  return attrs.slice(0, m.index) + `style=${q}${next}${q}` + attrs.slice(m.index + m[0].length);
}
