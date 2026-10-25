import { createContext, useContext, type ReactNode } from 'react';
import type { ImageLightboxTarget } from './ImageLightbox';

export type OpenImagePreview = (target: ImageLightboxTarget) => void;

const ImagePreviewContext = createContext<OpenImagePreview | null>(null);

export function ImagePreviewProvider({
  value,
  children,
}: {
  value: OpenImagePreview;
  children: ReactNode;
}) {
  return <ImagePreviewContext.Provider value={value}>{children}</ImagePreviewContext.Provider>;
}

export function useOpenImagePreview(): OpenImagePreview | null {
  return useContext(ImagePreviewContext);
}
