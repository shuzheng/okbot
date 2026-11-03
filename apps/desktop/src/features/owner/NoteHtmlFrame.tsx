import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isHttpUrl } from '../../utils/splitUrls';
import { ensureSrcdocBase, handleInDocumentHashClick } from '../../utils/noteAnchors';

const NOTE_SCROLLBAR_STYLE_ID = 'okbot-note-scrollbar';

/** Match chat `.scroll-fade` thin translucent scrollbar inside the srcdoc document. */
function noteScrollbarCss(light: boolean): string {
  const thumb = light ? 'rgba(24, 24, 27, 0.18)' : 'rgba(128, 128, 128, 0.22)';
  return `
html {
  scrollbar-width: thin;
  scrollbar-color: ${thumb} transparent;
}
::-webkit-scrollbar,
::-webkit-scrollbar:hover {
  width: 5px !important;
  height: 5px !important;
}
::-webkit-scrollbar-track,
::-webkit-scrollbar-track:hover {
  background: transparent;
}
::-webkit-scrollbar-thumb,
::-webkit-scrollbar-thumb:hover,
::-webkit-scrollbar-thumb:active {
  width: 5px;
  background: ${thumb};
  background-clip: padding-box;
  border: 0 solid transparent;
  border-radius: 999px;
  box-shadow: none;
}
::-webkit-scrollbar-corner {
  background: transparent;
}
`.trim();
}

function parentThemeIsLight(): boolean {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light') return true;
  if (theme === 'dark') return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

function applyNoteScrollbarStyle(doc: Document): void {
  const parent = doc.head || doc.documentElement;
  if (!parent) return;
  let el = doc.getElementById(NOTE_SCROLLBAR_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = NOTE_SCROLLBAR_STYLE_ID;
    parent.appendChild(el);
  }
  el.textContent = noteScrollbarCss(parentThemeIsLight());
}

/**
 * Sandboxed note HTML preview.
 * allow-same-origin (no allow-scripts) so the parent can intercept TOC/hash
 * clicks and scroll in place — empty sandbox lets #anchors blank the srcdoc.
 *
 * Also injects <base href="about:srcdoc">: under allow-same-origin, bare
 * href="#id" otherwise resolves to the parent page URL and replaces srcdoc.
 * Invariant: same-origin must never be paired with allow-scripts.
 */
export function NoteHtmlFrame({
  title,
  html,
  className,
}: {
  title: string;
  html: string;
  className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => ensureSrcdocBase(html), [html]);

  const bindHashLinks = useCallback(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      return;
    }
    if (!doc?.documentElement) return;
    // Ignore the initial about:blank document before srcdoc commits.
    const loc = (() => {
      try {
        return doc.defaultView?.location?.href ?? '';
      } catch {
        return '';
      }
    })();
    if (loc === 'about:blank' || loc === '') return;

    applyNoteScrollbarStyle(doc);

    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a');
      if (!anchor || !doc.contains(anchor)) return;
      const href = anchor.getAttribute('href');
      if (handleInDocumentHashClick(e, href, doc)) return;

      // Any non-hash navigation replaces srcdoc → white screen. Block it.
      // http(s) opens in a new parent tab instead of tearing down the preview.
      if (href == null || href.trim() === '') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (isHttpUrl(href)) {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (!/^mailto:/i.test(href.trim())) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    doc.addEventListener('click', onClick, true);
    return () => {
      doc.removeEventListener('click', onClick, true);
    };
  }, []);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let cleanup: (() => void) | undefined;

    const attach = () => {
      cleanup?.();
      cleanup = bindHashLinks() ?? undefined;
    };

    iframe.addEventListener('load', attach);
    // srcDoc may finish before listeners attach
    attach();

    // Re-apply scrollbar colors when app theme / OS scheme changes.
    const root = document.documentElement;
    const mo = new MutationObserver(() => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.documentElement) applyNoteScrollbarStyle(doc);
      } catch {
        /* ignore */
      }
    });
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onScheme = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.documentElement) applyNoteScrollbarStyle(doc);
      } catch {
        /* ignore */
      }
    };
    mql.addEventListener('change', onScheme);

    return () => {
      iframe.removeEventListener('load', attach);
      cleanup?.();
      mo.disconnect();
      mql.removeEventListener('change', onScheme);
    };
  }, [srcDoc, bindHashLinks]);

  return (
    <iframe
      ref={ref}
      className={className}
      title={title}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
    />
  );
}
