import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Liquid } from 'liquid-gooey';
import { t, type UiLang } from '../../i18n';
import { QuickTip } from '../../components/ui/QuickTip';
import {
  FileAttachIcon,
  FolderAttachIcon,
  ImageAttachIcon,
  PlusIcon,
} from '../../components/ui/icons';
import { prefersCoarsePointer } from '../../hooks/usePhoneLayout';

const FAN_TRANSITION = {
  duration: 320,
  ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/** Vertical stack spacing (px) between item centers above the +/X anchor. */
const STACK_STEP = 36;
/** Touch / phone stack uses a taller step so 44px hit targets do not overlap. */
const TOUCH_STACK_STEP = 48;

export type AttachKind = 'image' | 'file' | 'folder';

export type ComposerAttachMenuProps = {
  lang: UiLang;
  disabled?: boolean;
  onPick: (kind: AttachKind) => void;
};

function isGatewayWebUi(): boolean {
  return (
    typeof document !== 'undefined' && document.documentElement.dataset.okbotGateway === '1'
  );
}

export function ComposerAttachMenu({ lang, disabled, onPick }: ComposerAttachMenuProps) {
  const [open, setOpen] = useState(false);
  // SVG gooey filter is expensive on the Electron GPU process. Mount it only
  // while the fan is open or finishing its close, not for the whole idle session.
  // Phone / coarse WebUI skips gooey entirely — SVG filter hit-testing is unreliable
  // with fat-finger taps on the blurred blob, and the filter is costly on mobile GPUs.
  const [gooey, setGooey] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const gateway = isGatewayWebUi();
  const coarse = typeof window !== 'undefined' && prefersCoarsePointer();
  const simpleFan = gateway || coarse;
  const stackStep = simpleFan ? TOUCH_STACK_STEP : STACK_STEP;
  // Folder has no gateway-local path on WebUI; hide it so the fan is not a dead tap.
  const showFolder = !gateway;

  useEffect(() => {
    if (simpleFan) {
      if (gooey) setGooey(false);
      return;
    }
    if (open) {
      setGooey(true);
      return;
    }
    if (!gooey) return;
    const id = window.setTimeout(() => setGooey(false), 380);
    return () => window.clearTimeout(id);
  }, [open, gooey, simpleFan]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | PointerEvent | TouchEvent) => {
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
    // pointerdown + touchstart: phones often skip mousedown until after the tap.
    const t = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointer, true);
      document.addEventListener('mousedown', onPointer, true);
      document.addEventListener('touchstart', onPointer, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('mousedown', onPointer, true);
      document.removeEventListener('touchstart', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const pick = (kind: AttachKind) => {
    // Call onPick first so WebUI <input type=file>.click() stays in the same
    // user-gesture turn as this tap (iOS Safari). Close the fan after.
    onPick(kind);
    setOpen(false);
  };

  const toggleOpen = () => {
    if (disabled) return;
    setOpen((v) => !v);
  };

  // Stage sized for a vertical column (x≈0); tall enough for N×stack above the anchor.
  const itemCount = showFolder ? 3 : 2;
  const stageW = simpleFan ? 48 : 48;
  const stageH = stackStep * itemCount + (simpleFan ? 44 : 30);
  const btnSize = simpleFan ? 44 : 30;
  const itemLeft = (stageW - btnSize) / 2;

  const fanButtons: { kind: AttachKind; label: string; icon: ReactNode; step: number }[] = [
    { kind: 'image', label: t(lang, 'attachImage'), icon: <ImageAttachIcon />, step: itemCount },
    { kind: 'file', label: t(lang, 'attachFile'), icon: <FileAttachIcon />, step: itemCount - 1 },
  ];
  if (showFolder) {
    fanButtons.push({
      kind: 'folder',
      label: t(lang, 'attachFolder'),
      icon: <FolderAttachIcon />,
      step: 1,
    });
  }

  if (simpleFan) {
    return (
      <div
        ref={rootRef}
        className={`composer-attach composer-attach-simple${open ? ' open' : ''}${disabled ? ' disabled' : ''}`}
      >
        <div
          className="composer-attach-simple-stage"
          style={{ width: stageW, height: stageH }}
          aria-hidden={!open}
        >
          {fanButtons.map((item) => (
            <button
              key={item.kind}
              type="button"
              className="composer-attach-btn composer-attach-simple-btn"
              tabIndex={open ? 0 : -1}
              aria-hidden={!open}
              disabled={disabled || !open}
              aria-label={item.label}
              style={{
                bottom: 0,
                left: itemLeft,
                width: btnSize,
                height: btnSize,
                minWidth: btnSize,
                minHeight: btnSize,
                transform: open ? `translateY(-${stackStep * item.step}px)` : 'translateY(0)',
              }}
              onClick={() => pick(item.kind)}
            >
              {item.icon}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`composer-attach-btn composer-attach-toggle${open ? ' open' : ''}`}
          disabled={disabled}
          aria-label={open ? t(lang, 'attachMenuClose') : t(lang, 'attachMenuOpen')}
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <PlusIcon />
        </button>
      </div>
    );
  }

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
        shadow="none"
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
          <QuickTip text={t(lang, 'attachImage')}>
          <button
            type="button"
            className="composer-attach-btn"
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            disabled={disabled || !open}
            aria-label={t(lang, 'attachImage')}
            onClick={() => pick('image')}
          >
            <ImageAttachIcon />
          </button>
          </QuickTip>
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
          <QuickTip text={t(lang, 'attachFile')}>
          <button
            type="button"
            className="composer-attach-btn"
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            disabled={disabled || !open}
            aria-label={t(lang, 'attachFile')}
            onClick={() => pick('file')}
          >
            <FileAttachIcon />
          </button>
          </QuickTip>
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
          <QuickTip text={t(lang, 'attachFolder')}>
          <button
            type="button"
            className="composer-attach-btn"
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            disabled={disabled || !open}
            aria-label={t(lang, 'attachFolder')}
            onClick={() => pick('folder')}
          >
            <FolderAttachIcon />
          </button>
          </QuickTip>
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
            aria-label={open ? t(lang, 'attachMenuClose') : t(lang, 'attachMenuOpen')}
            aria-expanded={open}
            onClick={toggleOpen}
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
