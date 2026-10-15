/**
 * Mesh ask_assistant reply split: seal interim A, then ensure follow-up B does not
 * re-include A's text when the model repeats the pre-tool narration.
 */

export { stripLeadingCommittedInterim } from '@okbot/shared';
import { stripLeadingCommittedInterim } from '@okbot/shared';

/**
 * Live stream helper: after commit/rotate, hold deltas while they still match the
 * sealed interim prefix, then emit only the remainder (or the full held text if it
 * diverges). Prevents B from flashing A's text when the model repeats itself.
 */
export function createMeshFollowUpStripper() {
  let committed = '';
  let active = false;
  let held = '';
  let finished = false;

  return {
    noteCommitted(text: string) {
      committed = text || '';
      active = Boolean(committed.trim());
      held = '';
      finished = !active;
    },
    /** @returns delta to append+emit, or null to hold */
    acceptDelta(delta: string): string | null {
      if (!active || finished || !committed.trim()) {
        return delta;
      }
      held += delta;
      if (committed.startsWith(held)) {
        // Still inside the repeated interim — wait.
        return null;
      }
      if (held.startsWith(committed)) {
        finished = true;
        const rest = stripLeadingCommittedInterim(held, committed);
        held = '';
        return rest.length ? rest : null;
      }
      // Diverged from interim — show held as-is.
      finished = true;
      const out = held;
      held = '';
      return out;
    },
    /** Flush held buffer + strip; call before persist/done. */
    finalize(content: string): string {
      const raw = held ? held : content;
      held = '';
      finished = true;
      active = false;
      // If we already emitted stripped deltas into `content`, still strip in case
      // finalize is handed the full model output (incl. repeated interim).
      const candidate = content.trim() ? content : raw;
      return stripLeadingCommittedInterim(candidate, committed);
    },
    getCommitted(): string {
      return committed;
    },
  };
}
