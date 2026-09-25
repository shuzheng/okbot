import OpenAI, { toFile } from 'openai';
import type { ResolvedModelConfig } from '@okbot/shared';

export interface TranscribeAudioInput {
  model: ResolvedModelConfig;
  bytes: Uint8Array | Buffer;
  filename: string;
  mimeType?: string;
}

function errText(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const anyErr = err as Error & { status?: unknown; statusCode?: unknown; code?: unknown; error?: unknown };
    const parts = [err.name, err.message];
    if (anyErr.status != null) parts.push(String(anyErr.status));
    if (anyErr.statusCode != null) parts.push(String(anyErr.statusCode));
    if (anyErr.code != null) parts.push(String(anyErr.code));
    if (anyErr.error != null) parts.push(String(anyErr.error));
    return parts.filter(Boolean).join(' | ');
  }
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    return [o.name, o.message, o.status, o.statusCode, o.code, o.error]
      .filter((v) => v != null && v !== '')
      .map(String)
      .join(' | ');
  }
  return String(err);
}

function isSttUnsupported(err: unknown): boolean {
  const text = errText(err);
  const status =
    err && typeof err === 'object'
      ? Number((err as { status?: unknown; statusCode?: unknown }).status ??
          (err as { statusCode?: unknown }).statusCode)
      : NaN;
  if (status === 404 || status === 405 || status === 501) return true;
  return (
    /\b404\b/.test(text) ||
    /not\s*found/i.test(text) ||
    /does not (exist|support)/i.test(text) ||
    /unsupported.*(audio|transcri|whisper|speech)/i.test(text) ||
    /unknown endpoint/i.test(text) ||
    /no route/i.test(text)
  );
}

const STT_UNSUPPORTED_ZH =
  '当前模型服务不支持语音转写（/audio/transcriptions）。请改用支持 Whisper 的 OpenAI 兼容接口，或改为手动输入文字。';

/**
 * Speech-to-text via OpenAI-compatible /audio/transcriptions (Whisper).
 * Uses the configured provider baseURL + apiKey (same as chat).
 */
export async function transcribeAudio(input: TranscribeAudioInput): Promise<string> {
  if (!input.model.baseURL?.trim()) throw new Error('请先在设置里填写 baseURL');
  if (!input.model.apiKey?.trim()) throw new Error('请先在设置里填写 API Key');

  const baseURL = input.model.baseURL.replace(/\/$/, '');
  const client = new OpenAI({
    apiKey: input.model.apiKey,
    baseURL,
  });

  const buf = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  if (buf.byteLength < 64) throw new Error('录音太短，请按住或再说一会儿');

  const file = await toFile(buf, input.filename || 'voice.webm', {
    type: input.mimeType || 'audio/webm',
  });

  // Prefer classic Whisper; fall back to newer OpenAI STT model ids when available.
  const models = ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'];
  let lastErr: unknown;
  let sawUnsupported = false;
  for (const model of models) {
    try {
      const result = await client.audio.transcriptions.create({
        file,
        model,
        language: 'zh',
      });
      const text = (result.text || '').trim();
      if (text) return text;
      lastErr = new Error('转写结果为空');
    } catch (err) {
      lastErr = err;
      if (isSttUnsupported(err)) sawUnsupported = true;
    }
  }
  if (sawUnsupported) throw new Error(STT_UNSUPPORTED_ZH);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
