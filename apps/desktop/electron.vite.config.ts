import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig({
  main: {
    define: {
      __OKBOT_BUILD_DATE__: JSON.stringify(buildDate),
    },
    plugins: [externalizeDepsPlugin({ exclude: ['@okbot/shared', '@okbot/agent'] })],
    build: {
      rollupOptions: {
        // ws optional native deps — must stay external or Electron load fails
        external: ['bufferutil', 'utf-8-validate'],
        input: {
          index: resolve('electron/main.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/preload.ts'),
        },
      },
    },
  },
  renderer: {
    root: '.',
    // Avoid hostname "localhost" — some Macs lose 127.0.0.1 localhost in /etc/hosts
    // (ad-block hosts files), which makes electron-vite fail with ENOTFOUND.
    server: {
      host: '127.0.0.1',
      strictPort: false,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('index.html'),
        },
      },
    },
    plugins: [react()],
  },
});
