declare module '@xenova/transformers' {
  export const env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    localModelPath: string;
    backends: {
      onnx: {
        wasm: {
          wasmPaths?: string;
          numThreads?: number;
        };
      };
    };
  };

  export type ProgressCallback = (data: {
    status: string;
    file?: string;
    progress?: number;
  }) => void;

  export function pipeline(
    task: 'automatic-speech-recognition',
    model: string,
    options?: {
      quantized?: boolean;
      progress_callback?: ProgressCallback;
    },
  ): Promise<
    (
      audio: Float32Array | string,
      options?: Record<string, unknown>,
    ) => Promise<{ text: string }>
  >;
}
