import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, DownloadUpdateIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';

export type ImageLightboxTarget = {
  src: string;
  alt?: string;
  /** Suggested download filename (no path). */
  fileName?: string;
};

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.25;

function ZoomInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.5 7.5v6M7.5 10.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.5 10.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

async function downloadImage(src: string, fileName: string): Promise<void> {
  const name = (fileName || 'image.png').replace(/[\\/]/g, '_');
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    const a = document.createElement('a');
    a.href = src;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/**
 * Fullscreen image preview: fixed viewport cover, centered image, top-center zoom,
 * top-right download/close. Instant open/close (no FLIP / WAAPI morph) for reliability.
 * Portaled to body so drawer backdrop-filter cannot trap `position: fixed`.
 */
export function ImageLightbox(props: {
  lang: UiLang;
  target: ImageLightboxTarget;
  onClose: () => void;
  /** `cover` = fixed full-viewport (chat + resources). `pane` = absolute inset over parent. */
  variant?: 'pane' | 'cover';
}) {
  const { lang, target, onClose, variant = 'cover' } = props;
  const [scale, setScale] = useState(1);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setScale(1);
  }, [target.src]);

  const requestClose = useCallback(() => {
    onCloseRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setScale((s) => Math.min(ZOOM_MAX, s * ZOOM_STEP));
      } else if (e.key === '-') {
        e.preventDefault();
        setScale((s) => Math.max(ZOOM_MIN, s / ZOOM_STEP));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [requestClose]);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(ZOOM_MAX, s * ZOOM_STEP));
  }, []);
  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(ZOOM_MIN, s / ZOOM_STEP));
  }, []);

  const fileName =
    target.fileName ||
    (target.alt && /\.\w{2,5}$/.test(target.alt) ? target.alt : undefined) ||
    'image.png';

  const rootClass = [
    'chat-image-lightbox',
    variant === 'cover' ? 'chat-image-lightbox--cover' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const node = (
    <div
      className={rootClass}
      role="dialog"
      aria-modal="true"
      aria-label={t(lang, 'imagePreviewTitle')}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        className="chat-image-lightbox-backdrop"
        aria-hidden
        onClick={requestClose}
      />

      <div className="chat-image-lightbox-zoom">
        <button
          type="button"
          className="chat-image-lightbox-btn chat-image-lightbox-zoom-btn"
          onClick={zoomOut}
          title={t(lang, 'imagePreviewZoomOut')}
          aria-label={t(lang, 'imagePreviewZoomOut')}
          disabled={scale <= ZOOM_MIN + 0.001}
        >
          <ZoomOutIcon />
        </button>
        <button
          type="button"
          className="chat-image-lightbox-btn chat-image-lightbox-zoom-btn"
          onClick={zoomIn}
          title={t(lang, 'imagePreviewZoomIn')}
          aria-label={t(lang, 'imagePreviewZoomIn')}
          disabled={scale >= ZOOM_MAX - 0.001}
        >
          <ZoomInIcon />
        </button>
      </div>

      <div className="chat-image-lightbox-toolbar">
        <button
          type="button"
          className="chat-image-lightbox-btn"
          onClick={() => void downloadImage(target.src, fileName)}
          title={t(lang, 'imagePreviewDownload')}
          aria-label={t(lang, 'imagePreviewDownload')}
        >
          <DownloadUpdateIcon />
        </button>
        <button
          type="button"
          className="chat-image-lightbox-btn"
          onClick={requestClose}
          title={t(lang, 'close')}
          aria-label={t(lang, 'close')}
        >
          <CloseIcon />
        </button>
      </div>

      <div
        className="chat-image-lightbox-stage"
        onClick={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        <img
          className="chat-image-lightbox-img"
          src={target.src}
          alt={target.alt || ''}
          style={{ transform: `scale(${scale})` }}
          draggable={false}
        />
      </div>
    </div>
  );

  if (variant === 'cover' && typeof document !== 'undefined') {
    return createPortal(node, document.body);
  }
  return node;
}
