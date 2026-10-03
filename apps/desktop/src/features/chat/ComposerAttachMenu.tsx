import { useEffect, useRef, useState } from 'react';
import { Liquid } from 'liquid-gooey';
import { t, type UiLang } from '../../i18n';
import {
  FileAttachIcon,
  FolderAttachIcon,
  ImageAttachIcon,
  PlusIcon,
} from '../../components/ui/icons';

const FAN_TRANSITION = {
  duration: 320,
  ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/** Vertical stack spacing (px) between item centers above the +/X anchor. */
const STACK_STEP = 36;

export type AttachKind = 'image' | 'file' | 'folder';

export type ComposerAttachMenuProps = {
  lang: UiLang;
  disabled?: boolean;
  onPick: (kind: AttachKind) => void;
};

export function ComposerAttachMenu({ lang, disabled, onPick }: ComposerAttachMenuProps) {
  const [open, setOpen] = useState(false);
  // SVG gooey filter is expensive on the Electron GPU process. Mount it only
  // while the fan is open or finishing its close, not for the whole idle session.
  const [gooey, setGooey] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setGooey(true);
      return;
    }
    if (!gooey) return;
    const id = window.setTimeout(() => setGooey(false), 380);
    return () => window.clearTimeout(id);
  }, [open, gooey]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | PointerEvent) => {
      const el = e.target as Node | null;
      if (rootRef.current?.contains(el)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    // Defer so the opening click does not immediately close.
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onPointer, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const pick = (kind: AttachKind) => {
    setOpen(false);
    onPick(kind);
  };

  // Stage sized for a vertical column (x≈0); tall enough for 3×STACK_STEP above the anchor.
  const stageW = 48;
  const stageH = STACK_STEP * 3 + 30; // 138
  const itemLeft = (stageW - 30) / 2; // center 30px btn in stage

  return (
    <div
      ref={rootRef}
      className={`composer-attach${open ? ' open' : ''}${disabled ? ' disabled' : ''}`}
    >
      {gooey ? (
      <Liquid
        className="composer-attach-liquid"
        fill="var(--composer-attach)"
        blur={7}
        contrast={18}
        filterPadding={48}
        shadow="var(--composer-attach-shadow)"
        // Library root inline-style is position:relative (caller style wins).
        // Without absolute, the stack stage stays in flow, bottom:0 does
        // not pin it, and the anchor button drops below the 30px slot — clipped
        // by .main overflow:hidden, leaving an empty prefix.
        style={{ position: 'absolute', width: stageW, height: stageH }}
      >
        {/* Image — top of vertical stack */}
        <Liquid.Item
          className="composer-attach-item"
          style={{ position: 'absolute', left: itemLeft, bottom: 0 }}
          x={0}
          y={open ? -STACK_STEP * 3 : 0}
          transition={FAN_TRANSITION}
          delay={45}
        >
          <button
            type="button"
            className="composer-attach-btn"
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            disabled={disabled || !open}
            title={t(lang, 'attachImage')}
            aria-label={t(lang, 'attachImage')}
            onClick={() => pick('image')}
          >
            <ImageAttachIcon />
          </button>
        </Liquid.Item>

        {/* File — middle */}
        <Liquid.Item
          className="composer-attach-item"
          style={{ position: 'absolute', left: itemLeft, bottom: 0 }}
          x={0}
          y={open ? -STACK_STEP * 2 : 0}
          transition={FAN_TRANSITION}
          delay={22}
        >
          <button
            type="button"
            className="composer-attach-btn"
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            disabled={disabled || !open}
            title={t(lang, 'attachFile')}
            aria-label={t(lang, 'attachFile')}
            onClick={() => pick('file')}
          >
            <FileAttachIcon />
          </button>
        </Liquid.Item>

        {/* Folder — just above +/X */}
        <Liquid.Item
          className="composer-attach-item"
          style={{ position: 'absolute', left: itemLeft, bottom: 0 }}
          x={0}
          y={open ? -STACK_STEP : 0}
          transition={FAN_TRANSITION}
          delay={0}
        >
          <button
            type="button"
            className="composer-attach-btn"
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            disabled={disabled || !open}
            title={t(lang, 'attachFolder')}
            aria-label={t(lang, 'attachFolder')}
            onClick={() => pick('folder')}
          >
            <FolderAttachIcon />
          </button>
        </Liquid.Item>

        {/* + / close — anchor */}
        <Liquid.Item
          className="composer-attach-item"
          style={{ position: 'absolute', left: itemLeft, bottom: 0 }}
        >
          <button
            type="button"
            className={`composer-attach-btn composer-attach-toggle${open ? ' open' : ''}`}
            disabled={disabled}
            title={open ? t(lang, 'attachMenuClose') : t(lang, 'attachMenuOpen')}
            aria-label={open ? t(lang, 'attachMenuClose') : t(lang, 'attachMenuOpen')}
            aria-expanded={open}
            onClick={() => {
              if (disabled) return;
              setOpen((v) => !v);
            }}
          >
            <PlusIcon />
          </button>
        </Liquid.Item>
      </Liquid>
      ) : (
        <button
          type="button"
          className="composer-attach-btn composer-attach-toggle"
          disabled={disabled}
          title={t(lang, 'attachMenuOpen')}
          aria-label={t(lang, 'attachMenuOpen')}
          aria-expanded={false}
          onClick={() => {
            if (disabled) return;
            setGooey(true);
            window.requestAnimationFrame(() => setOpen(true));
          }}
        >
          <PlusIcon />
        </button>
      )}
    </div>
  );
}
