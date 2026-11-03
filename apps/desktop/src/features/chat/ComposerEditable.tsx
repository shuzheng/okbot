import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { MentionEntityRef } from '../../utils/entityMentions';
import {
  clearComposerEditable,
  deleteAtomBeforeCaret,
  getCaretDraftOffset,
  isComposerEditableEmpty,
  placeCaretAtEnd,
  renderDraftIntoEditable,
  serializeComposerEditable,
  setCaretDraftOffset,
} from './composerEditableDom';

export type ComposerEditableProps = {
  draft: string;
  catalog: readonly MentionEntityRef[];
  readOnly?: boolean;
  placeholder: string;
  removeAriaLabel: string;
  /** Ref attached to the contenteditable element (focus / scroll / height probe). */
  editableRef: RefObject<HTMLElement | null>;
  onDraftChange: (value: string) => void;
  /** Caret offset in the serialized draft string (for @ query). */
  onCaretDraftOffset: (draft: string, offset: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLDivElement>) => void;
  onRemoveMention: (entity: MentionEntityRef) => void;
  /**
   * Bumped by parent after an applyMention so we rebuild + place caret
   * (draft may equal last emitted if only caret matters — always rebuild when set).
   */
  applyCaret?: number | null;
  /** Bumped on session switch to place caret at end. */
  seekEndToken?: number;
};

/**
 * Contenteditable composer body: plain text + EntityMentionChip atoms mixed
 * in insertion order. Serializes to @[kind:id|label] for send/persist.
 */
export const ComposerEditable = memo(function ComposerEditable({
  draft,
  catalog,
  readOnly = false,
  placeholder,
  removeAriaLabel,
  editableRef,
  onDraftChange,
  onCaretDraftOffset,
  onKeyDown,
  onPaste,
  onRemoveMention,
  applyCaret = null,
  seekEndToken = 0,
}: ComposerEditableProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef(draft);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const onRemoveRef = useRef(onRemoveMention);
  onRemoveRef.current = onRemoveMention;
  const removeAriaRef = useRef(removeAriaLabel);
  removeAriaRef.current = removeAriaLabel;

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      localRef.current = el;
      (editableRef as MutableRefObject<HTMLElement | null>).current = el;
    },
    [editableRef],
  );

  const rebuild = useCallback((text: string, caret?: number | 'end') => {
    const el = localRef.current;
    if (!el) return;
    renderDraftIntoEditable(
      el,
      text,
      catalogRef.current,
      (entity) => onRemoveRef.current(entity),
      removeAriaRef.current,
    );
    el.classList.toggle('is-empty', isComposerEditableEmpty(el));
    if (caret === 'end') {
      placeCaretAtEnd(el);
    } else if (typeof caret === 'number') {
      setCaretDraftOffset(el, caret);
    }
  }, []);

  // External draft sync (session switch, voice append, chip remove) or catalog refresh.
  const catalogEpochRef = useRef(catalog);
  useLayoutEffect(() => {
    const catalogChanged = catalogEpochRef.current !== catalog;
    catalogEpochRef.current = catalog;
    if (draft === lastEmittedRef.current && !catalogChanged) {
      const el = localRef.current;
      if (el) el.classList.toggle('is-empty', isComposerEditableEmpty(el));
      return;
    }
    // Preserve caret when only catalog identity refreshed.
    const el = localRef.current;
    const caret =
      catalogChanged && draft === lastEmittedRef.current && el
        ? getCaretDraftOffset(el)
        : undefined;
    lastEmittedRef.current = draft;
    rebuild(draft, caret);
  }, [draft, catalog, rebuild]);

  // Mention apply: always rebuild and place caret even if draft matched emit.
  useLayoutEffect(() => {
    if (applyCaret == null) return;
    lastEmittedRef.current = draft;
    rebuild(draft, applyCaret);
  }, [applyCaret, draft, rebuild]);

  // Mount once
  useLayoutEffect(() => {
    rebuild(draft);
    lastEmittedRef.current = draft;
    return () => {
      const el = localRef.current;
      if (el) clearComposerEditable(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Parent asks to seek end (session draft restore).
  useLayoutEffect(() => {
    if (!seekEndToken) return;
    const el = localRef.current;
    if (!el) return;
    placeCaretAtEnd(el);
    el.scrollTop = el.scrollHeight;
  }, [seekEndToken]);

  const emitFromDom = useCallback(() => {
    const el = localRef.current;
    if (!el) return;
    const next = serializeComposerEditable(el);
    el.classList.toggle('is-empty', isComposerEditableEmpty(el));
    lastEmittedRef.current = next;
    onDraftChange(next);
    onCaretDraftOffset(next, getCaretDraftOffset(el));
  }, [onCaretDraftOffset, onDraftChange]);

  const handleInput = useCallback(
    (_e: FormEvent<HTMLDivElement>) => {
      if (readOnly) return;
      emitFromDom();
    },
    [emitFromDom, readOnly],
  );

  const syncCaret = useCallback(() => {
    const el = localRef.current;
    if (!el || readOnly) return;
    const value = serializeComposerEditable(el);
    onCaretDraftOffset(value, getCaretDraftOffset(el));
  }, [onCaretDraftOffset, readOnly]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (readOnly) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Backspace' && !e.nativeEvent.isComposing) {
        const el = localRef.current;
        if (el && deleteAtomBeforeCaret(el)) {
          e.preventDefault();
          emitFromDom();
          return;
        }
      }
      onKeyDown(e);
    },
    [emitFromDom, onKeyDown, readOnly],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      if (readOnly) {
        e.preventDefault();
        return;
      }
      onPaste(e);
      if (e.defaultPrevented) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      document.execCommand('insertText', false, text);
    },
    [onPaste, readOnly],
  );

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.contentEditable = readOnly ? 'false' : 'true';
  }, [readOnly]);

  return (
    <div
      ref={setRefs}
      className={`composer-editable${readOnly ? ' is-readonly' : ''}`}
      role="textbox"
      aria-multiline="true"
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      spellCheck={false}
      suppressContentEditableWarning
      contentEditable={!readOnly}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onKeyUp={syncCaret}
      onClick={syncCaret}
      onPaste={handlePaste}
    />
  );
});
