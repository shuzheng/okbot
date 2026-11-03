/**
 * In-document hash helpers for note HTML iframes and markdown TOC links.
 * Clicking href="#id" inside a sandboxed srcdoc iframe (or SPA markdown)
 * must scroll in place — not navigate the frame / app to a blank page.
 *
 * Electron/Chromium quirk: srcdoc + sandbox="allow-same-origin" inherits the
 * parent document base URL, so href="#id" resolves to parentUrl#id and
 * replaces the srcdoc (white screen). Inject <base href="about:srcdoc"> so
 * fragments stay in-document; parent click intercept remains defense in depth.
 */

/** If href is an in-document fragment, return the decoded id (may be ""). Else null. */
export function inDocumentHashId(href: string | undefined | null): string | null {
  if (href == null) return null;
  const raw = href.trim();
  if (!raw) return null;
  if (raw.startsWith('#')) {
    return decodeHashId(raw.slice(1));
  }
  // Some engines expose the srcdoc URL as about:srcdoc#id
  const about = /^about:srcdoc(#.*)?$/i.exec(raw);
  if (about) {
    const hash = about[1] || '';
    return decodeHashId(hash.startsWith('#') ? hash.slice(1) : hash);
  }
  return null;
}

function decodeHashId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/**
 * Ensure srcdoc HTML has <base href="about:srcdoc"> so #anchors do not resolve
 * against the parent page URL under allow-same-origin sandbox.
 */
export function ensureSrcdocBase(html: string): string {
  if (!html) return html;
  if (/<base\b/i.test(html)) return html;
  const baseTag = '<base href="about:srcdoc">';
  const headOpen = /<head([^>]*)>/i.exec(html);
  if (headOpen && headOpen.index != null) {
    const i = headOpen.index + headOpen[0].length;
    return `${html.slice(0, i)}${baseTag}${html.slice(i)}`;
  }
  const htmlOpen = /<html([^>]*)>/i.exec(html);
  if (htmlOpen && htmlOpen.index != null) {
    const i = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, i)}<head>${baseTag}</head>${html.slice(i)}`;
  }
  return `<head>${baseTag}</head>${html}`;
}

/** Scroll to element id (or name) inside doc. Returns whether a target was found. */
export function scrollToDocumentId(doc: Document, id: string): boolean {
  if (!id) return false;
  let el: Element | null = null;
  try {
    el = doc.getElementById(id);
  } catch {
    el = null;
  }
  if (!el) {
    const named = doc.getElementsByName(id);
    el = named.item(0);
  }
  if (!el) return false;
  const win = doc.defaultView;
  if (win) {
    const top =
      el.getBoundingClientRect().top + (win.scrollY || win.pageYOffset || 0) - 8;
    win.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  } else {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return true;
}

/**
 * Click handler for in-document hash links. preventDefault + scrollIntoView.
 * Returns true when the event was handled as a hash jump.
 */
export function handleInDocumentHashClick(
  event: { preventDefault(): void; stopPropagation(): void },
  href: string | undefined | null,
  doc: Document,
): boolean {
  const id = inDocumentHashId(href);
  if (id === null) return false;
  event.preventDefault();
  event.stopPropagation();
  if (id) scrollToDocumentId(doc, id);
  return true;
}
