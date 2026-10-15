/**
 * Collapse composer draft text for the session-list subtitle.
 * Returns null when there is nothing meaningful to show (empty / whitespace-only).
 */
export function formatSessionDraftPreview(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  return text || null;
}
