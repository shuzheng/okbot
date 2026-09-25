# Vendored renderer deps

`xenova-transformers` — browser bundle of `@xenova/transformers@2.17.2` (`transformers.js`).
Wired via Vite alias in `electron.vite.config.ts` (not a pnpm registry dependency), so installs work offline in CN.

ORT WASM binaries live in `../public/wasm/` (not duplicated here).
Whisper ONNX weights live in `../public/models/Xenova/whisper-tiny/`.
