/// <reference types="vite/client" />

import type { OkbotApi } from '../electron/preload';

declare global {
  interface Window {
    okbot: OkbotApi;
  }
}

export {};

declare module '*.png' {
  const src: string;
  export default src;
}
