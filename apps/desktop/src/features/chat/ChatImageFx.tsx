import { memo, type MouseEvent } from 'react';
import { useOpenImagePreview } from './ImagePreviewContext';

export type ChatImageFxProps = {
  /** Resolved image URL (gateway /v1/media, data:, …). Omit while still loading. */
  src?: string | null;
  alt?: string;
  /** When true and `src` is empty, show a lightweight loading placeholder. */
  loading?: boolean;
};

/**
 * Chat thumbnail + lightbox click.
 * Always renders a real `<img>` when `src` is set (no WebGL canvas path).
 */
export const ChatImageFx = memo(function ChatImageFx({
  src,
  alt,
  loading = false,
}: ChatImageFxProps) {
  const openPreview = useOpenImagePreview();

  const open = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!src) return;
    openPreview?.({
      src,
      alt: alt || '',
      fileName: alt || undefined,
    });
  };

  if (src) {
    return (
      <button
        type="button"
        className="md-chat-image-btn"
        onClick={open}
        aria-label={alt || 'image'}
      >
        <img className="md-chat-thumb" src={src} alt={alt || ''} />
      </button>
    );
  }

  if (!loading) return null;

  return <span className="md-asset-loading">{alt || 'image'}…</span>;
});
