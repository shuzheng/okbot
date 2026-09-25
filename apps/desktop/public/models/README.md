# On-device Whisper models

Bundled quantized `Xenova/whisper-tiny` (ONNX) for offline speech-to-text.

- Served as Vite `public/` assets → packaged with the renderer.
- `resources/models` is a symlink here for discoverability.
- Obtained from ModelScope (`Xenova/whisper-tiny`) — Hugging Face CDN was unreachable from CN.
