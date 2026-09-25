/**
 * On-device Whisper STT via @xenova/transformers (quantized whisper-tiny).
 * Models are bundled under public/models (→ resources/models) — no Google / provider STT.
 */

import type { UiLang } from '../i18n';

export type WhisperLoadProgress = {
  status: string;
  file?: string;
  progress?: number;
};

type AsrPipeline = (audio: Float32Array | string, options?: Record<string, unknown>) => Promise<{ text: string }>;

let pipelinePromise: Promise<AsrPipeline> | null = null;

function assetBase(): string {
  // Dev: http://127.0.0.1:PORT/  Prod (loadFile): file://.../renderer/index.html
  return new URL('.', document.baseURI).href;
}

function configureEnv(env: {
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  localModelPath: string;
  backends: { onnx: { wasm: { wasmPaths?: string; numThreads?: number } } };
}): void {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = new URL('models/', assetBase()).href;
  // onnxruntime wasm shipped next to the renderer (copied from the package in build/dev).
  env.backends.onnx.wasm.wasmPaths = new URL('wasm/', assetBase()).href;
  env.backends.onnx.wasm.numThreads = 1;
}

export function whisperLanguage(lang: UiLang): string {
  return lang === 'en' ? 'english' : 'chinese';
}

export async function ensureLocalWhisper(
  onProgress?: (p: WhisperLoadProgress) => void,
): Promise<AsrPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      configureEnv(env as Parameters<typeof configureEnv>[0]);
      const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        quantized: true,
        progress_callback: (data: WhisperLoadProgress) => {
          onProgress?.(data);
        },
      });
      return asr as AsrPipeline;
    })().catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

export async function transcribeWithLocalWhisper(
  audio: Float32Array,
  lang: UiLang,
  onProgress?: (p: WhisperLoadProgress) => void,
): Promise<string> {
  const asr = await ensureLocalWhisper(onProgress);
  const result = await asr(audio, {
    language: whisperLanguage(lang),
    task: 'transcribe',
    // Short voice notes — skip chunking overhead for clips under ~30s.
    return_timestamps: false,
  });
  const text = (result?.text || '').trim();
  return text;
}
