/** Escape text for safe insertion into HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Lightweight JSON syntax highlight for trusted `JSON.stringify` output.
 * Tokenize on the raw string first, then escape — escaping quotes before the
 * regex (as in an earlier attempt) leaves keys/strings unhighlighted.
 */
export function highlightJson(raw: string): string {
  // strings (optional key colon), numbers, literals, punctuation
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out += escapeHtml(raw.slice(last, m.index));
    const [, str, keyColon, num, lit, punct] = m;
    if (str !== undefined) {
      if (keyColon !== undefined) {
        const ws = keyColon.slice(0, -1);
        out += `<span class="turn-trace-json-key">${escapeHtml(str)}</span>${escapeHtml(ws)}<span class="turn-trace-json-punct">:</span>`;
      } else {
        out += `<span class="turn-trace-json-string">${escapeHtml(str)}</span>`;
      }
    } else if (num !== undefined) {
      out += `<span class="turn-trace-json-number">${num}</span>`;
    } else if (lit !== undefined) {
      const cls = lit === 'null' ? 'turn-trace-json-null' : 'turn-trace-json-bool';
      out += `<span class="${cls}">${lit}</span>`;
    } else if (punct !== undefined) {
      out += `<span class="turn-trace-json-punct">${escapeHtml(punct)}</span>`;
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(raw.slice(last));
  return out;
}
