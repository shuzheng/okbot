import {
  normalizeApiFormat,
  redactSensitiveText,
  type ApiFormat,
  type AppSettings,
  type CatalogModel,
} from '@okbot/shared';

/** Model provider probes shared by Electron IPC and the gateway RPC. */

export type DiscoverModelsInput = { baseURL?: string; apiKey?: string; providerId?: string };
export type TestModelConnectionInput = {
  baseURL?: string;
  apiKey?: string;
  apiFormat?: ApiFormat | string;
  modelId?: string;
  providerId?: string;
};

function trimBaseUrl(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').trim().replace(/\/+$/, '');
}

function stripBearer(raw: unknown): string {
  let key = (typeof raw === 'string' ? raw : '').trim();
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, '').trim();
  return key;
}

/**
 * Gateway responses blank provider keys. A client may name a saved provider instead
 * of sending the key. The saved key is used only when the base URL is the saved one,
 * so a caller cannot send the stored key to a host of its choice.
 */
export function resolveProbeApiKey(
  settings: Pick<AppSettings, 'model'>,
  input: { baseURL?: string; apiKey?: string; providerId?: string },
): string {
  const direct = stripBearer(input.apiKey);
  if (direct) return direct;
  const providerId = (input.providerId || '').trim();
  if (!providerId) return '';
  const provider = settings.model?.providers?.find((p) => p.id === providerId);
  if (!provider) return '';
  if (trimBaseUrl(provider.baseURL) !== trimBaseUrl(input.baseURL)) return '';
  return stripBearer(provider.apiKey);
}

/**
 * Gateway callers may probe only a base URL that is already saved for a provider.
 * Otherwise `discoverModels` / `testModelConnection` would let a token holder make
 * this host send requests to any address (for example LAN or link-local services).
 */
export function isSavedProbeBaseUrl(settings: Pick<AppSettings, 'model'>, input: { baseURL?: unknown }): boolean {
  const want = trimBaseUrl(typeof input.baseURL === 'string' ? input.baseURL : '');
  if (!want) return false;
  return (settings.model?.providers ?? []).some((p) => trimBaseUrl(p.baseURL) === want);
}

export async function discoverModels(
  settings: Pick<AppSettings, 'model'>,
  payload: DiscoverModelsInput,
): Promise<{ ok: boolean; models?: CatalogModel[]; error?: string }> {
  const baseURL = trimBaseUrl(payload?.baseURL);
  const apiKey = resolveProbeApiKey(settings, payload ?? {});
  if (!baseURL) return { ok: false, error: '请先填写 BaseURL' };
  if (!apiKey) return { ok: false, error: '请先填写 API Key' };
  try {
    const res = await fetch(`${baseURL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const hint =
        res.status === 401 || res.status === 403
          ? '（API Key 无效或无权限，请核对设置里的密钥是否与可正常对话的一致）'
          : '';
      return {
        ok: false,
        error: redactSensitiveText(
          `拉取模型失败 HTTP ${res.status}${hint}${body ? `: ${body.slice(0, 200)}` : ''}`,
          apiKey,
        ),
      };
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const rows = Array.isArray(json?.data) ? json.data : [];
    const seen = new Set<string>();
    const models: CatalogModel[] = [];
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push({ id, name: id, contextWindow: 128_000, maxTokens: null, enabled: true });
    }
    if (!models.length) return { ok: false, error: '接口未返回可用模型，请手动添加' };
    return { ok: true, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: redactSensitiveText(`拉取模型失败：${msg}`, apiKey) };
  }
}

export async function testModelConnection(
  settings: Pick<AppSettings, 'model'>,
  payload: TestModelConnectionInput,
): Promise<{ ok: boolean; error?: string }> {
  const baseURL = trimBaseUrl(payload?.baseURL);
  const apiKey = resolveProbeApiKey(settings, payload ?? {});
  const modelId = (payload?.modelId || '').trim();
  const apiFormat = normalizeApiFormat(payload?.apiFormat);
  if (!baseURL) return { ok: false, error: '请先填写 BaseURL' };
  if (!apiKey) return { ok: false, error: '请先填写 API Key' };
  if (!modelId) return { ok: false, error: '缺少模型 ID' };

  const redact = (msg: string): string => redactSensitiveText(msg, apiKey).slice(0, 240);
  const responses = apiFormat === 'responses';
  try {
    const res = await fetch(`${baseURL}/${responses ? 'responses' : 'chat/completions'}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(
        responses
          ? { model: modelId, input: 'ping', max_output_tokens: 1 }
          : { model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false },
      ),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const hint =
        res.status === 401 || res.status === 403
          ? '（API Key 无效或无权限）'
          : res.status === 404
            ? '（路径或模型不存在，请核对 BaseURL / 模型 ID / API 格式）'
            : '';
      return { ok: false, error: redact(`连通失败 HTTP ${res.status}${hint}${body ? `: ${body}` : ''}`) };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: redact(`连通失败：${msg}`) };
  }
}
