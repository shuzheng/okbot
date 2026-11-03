/**
 * Imperative DOM helpers for the composer contenteditable.
 * Chips are contentEditable=false atoms; draft serializes to @[kind:id|label] tokens.
 */
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { EntityMentionChip } from '../../components/ui/EntityMentionChip';
import {
  formatMentionToken,
  splitEntityMentions,
  type MentionEntityRef,
} from '../../utils/entityMentions';

const ATOM_ATTR = 'data-mention-token';
const ROOT_KEY = '__okbotMentionRoot';

type AtomEl = HTMLElement & { [ROOT_KEY]?: Root };

function isAtom(el: Node): el is AtomEl {
  return (
    el.nodeType === Node.ELEMENT_NODE &&
    Boolean((el as HTMLElement).getAttribute?.(ATOM_ATTR))
  );
}

/** Serialize contenteditable contents → send/persist draft (tokens inline). */
export function serializeComposerEditable(root: HTMLElement): string {
  let out = '';
  let skipLeadingNewline = true;

  const walk = (node: Node, inBlock = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || '';
      if (t) {
        out += t;
        skipLeadingNewline = false;
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.getAttribute(ATOM_ATTR)) {
      out += el.getAttribute(ATOM_ATTR) || '';
      skipLeadingNewline = false;
      return;
    }
    const tag = el.tagName;
    if (tag === 'BR') {
      out += '\n';
      skipLeadingNewline = false;
      return;
    }
    const block = tag === 'DIV' || tag === 'P' || tag === 'LI';
    if (block && !skipLeadingNewline && !out.endsWith('\n')) {
      out += '\n';
    }
    for (const child of Array.from(el.childNodes)) {
      walk(child, block || inBlock);
    }
  };

  for (const child of Array.from(root.childNodes)) {
    walk(child);
  }
  return out;
}

function unmountAtom(el: AtomEl) {
  const root = el[ROOT_KEY];
  if (root) {
    try {
      root.unmount();
    } catch {
      /* already unmounted */
    }
    delete el[ROOT_KEY];
  }
}

export function clearComposerEditable(root: HTMLElement) {
  for (const child of Array.from(root.childNodes)) {
    if (isAtom(child)) unmountAtom(child);
  }
  root.replaceChildren();
}

function createMentionAtom(
  entity: MentionEntityRef,
  onRemove: (entity: MentionEntityRef) => void,
  removeAriaLabel: string,
): AtomEl {
  const span = document.createElement('span') as AtomEl;
  span.contentEditable = 'false';
  span.setAttribute(ATOM_ATTR, formatMentionToken(entity));
  span.dataset.mentionKind = entity.kind;
  span.dataset.mentionId = entity.id;
  span.dataset.mentionLabel = entity.label;
  span.className = 'composer-mention-atom';
  const root = createRoot(span);
  span[ROOT_KEY] = root;
  root.render(
    createElement(EntityMentionChip, {
      entity,
      onClick: () => onRemove(entity),
      'aria-label': removeAriaLabel,
    }),
  );
  return span;
}

/** Rebuild contenteditable from a draft string (external / mention apply). */
export function renderDraftIntoEditable(
  root: HTMLElement,
  draft: string,
  catalog: readonly MentionEntityRef[],
  onRemove: (entity: MentionEntityRef) => void,
  removeAriaLabel: string,
) {
  clearComposerEditable(root);
  const segs = splitEntityMentions(draft || '', catalog);
  if (!segs.length) {
    // Keep a single empty text node so caret has a home.
    root.appendChild(document.createTextNode(''));
    return;
  }
  for (const seg of segs) {
    if (seg.kind === 'text') {
      root.appendChild(document.createTextNode(seg.text));
    } else {
      root.appendChild(createMentionAtom(seg.entity, onRemove, removeAriaLabel));
    }
  }
  // Trailing text node so caret can sit after a final chip.
  if (!root.lastChild || root.lastChild.nodeType !== Node.TEXT_NODE) {
    root.appendChild(document.createTextNode(''));
  }
}

/** Draft-string offset of the current collapsed caret (or selection start). */
export function getCaretDraftOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return serializeComposerEditable(root).length;
  const caretRange = sel.getRangeAt(0);
  const pre = document.createRange();
  try {
    pre.selectNodeContents(root);
    pre.setEnd(caretRange.startContainer, caretRange.startOffset);
  } catch {
    return serializeComposerEditable(root).length;
  }
  const frag = pre.cloneContents();
  const holder = document.createElement('div');
  holder.appendChild(frag);
  return serializeComposerEditable(holder).length;
}

/** Place collapsed caret at a draft-string offset. */
export function setCaretDraftOffset(root: HTMLElement, offset: number) {
  const target = Math.max(0, offset);
  let remaining = target;

  const placeInText = (textNode: Text, at: number) => {
    const range = document.createRange();
    const safe = Math.max(0, Math.min(at, textNode.data.length));
    range.setStart(textNode, safe);
    range.collapse(true);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const len = textNode.data.length;
      if (remaining <= len) {
        placeInText(textNode, remaining);
        return true;
      }
      remaining -= len;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as HTMLElement;
    if (el.getAttribute(ATOM_ATTR)) {
      const token = el.getAttribute(ATOM_ATTR) || '';
      if (remaining <= token.length) {
        // Land just after the chip (prefer following text node).
        const next = el.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE) {
          placeInText(next as Text, 0);
        } else {
          const range = document.createRange();
          range.setStartAfter(el);
          range.collapse(true);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        return true;
      }
      remaining -= token.length;
      return false;
    }
    if (el.tagName === 'BR') {
      if (remaining <= 1) {
        const range = document.createRange();
        range.setStartAfter(el);
        range.collapse(true);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        return true;
      }
      remaining -= 1;
      return false;
    }
    for (const child of Array.from(el.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  };

  for (const child of Array.from(root.childNodes)) {
    if (walk(child)) return;
  }
  // Fallback: end
  placeCaretAtEnd(root);
}

export function placeCaretAtEnd(root: HTMLElement) {
  root.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * If caret is collapsed just after a mention atom, delete that atom.
 * Returns true when handled.
 */
export function deleteAtomBeforeCaret(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  const { startContainer, startOffset } = range;

  let atom: AtomEl | null = null;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    if (startOffset !== 0) return false;
    let prev: Node | null = startContainer.previousSibling;
    while (
      prev &&
      prev.nodeType === Node.TEXT_NODE &&
      !(prev as Text).data
    ) {
      prev = prev.previousSibling;
    }
    if (prev && isAtom(prev)) atom = prev;
  } else if (startContainer.nodeType === Node.ELEMENT_NODE) {
    const el = startContainer as HTMLElement;
    if (el === root) {
      const prev = root.childNodes[startOffset - 1];
      if (prev && isAtom(prev)) atom = prev;
    } else {
      const child = el.childNodes[startOffset - 1];
      if (child && isAtom(child)) atom = child;
      else if (
        startOffset === 0 &&
        el.previousSibling &&
        isAtom(el.previousSibling)
      ) {
        atom = el.previousSibling as AtomEl;
      }
    }
  }

  if (!atom) return false;
  const parent = atom.parentNode;
  const next = atom.nextSibling;
  const prev = atom.previousSibling;
  unmountAtom(atom);
  atom.remove();

  const place = document.createRange();
  if (next && next.nodeType === Node.TEXT_NODE) {
    place.setStart(next, 0);
  } else if (prev && prev.nodeType === Node.TEXT_NODE) {
    place.setStart(prev, (prev as Text).data.length);
  } else if (prev) {
    place.setStartAfter(prev);
  } else if (next) {
    place.setStartBefore(next);
  } else if (parent) {
    // Ensure an empty text node remains for caret.
    const text = document.createTextNode('');
    parent.appendChild(text);
    place.setStart(text, 0);
  } else {
    return true;
  }
  place.collapse(true);
  sel.removeAllRanges();
  sel.addRange(place);
  return true;
}

/** True when editable has no visible text and no mention atoms. */
export function isComposerEditableEmpty(root: HTMLElement): boolean {
  return serializeComposerEditable(root).trim().length === 0 &&
    !root.querySelector(`[${ATOM_ATTR}]`);
}
