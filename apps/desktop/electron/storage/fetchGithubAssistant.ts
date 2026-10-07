/**
 * Fetch a public GitHub / raw assistant package and parse it.
 * Reuses the same package format as local `.okbot` import. No auth tokens.
 * SSRF: same hardened pipeline as web_fetch (DNS pin, hop-by-hop redirect).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GITHUB_ASSISTANT_KNOWN_PATHS,
  githubContentsApiUrl,
  githubRawFileUrl,
  parseAssistantPackage,
  parseGithubAssistantSource,
  ssrfHttpGet,
  type AssistantPackageContents,
  type GithubAssistantPlan,
} from '@okbot/agent';
import { readAssistantPackageArchive } from './assistantPackageIo';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 1_000_000;
const USER_AGENT = 'OkBot-AssistantMarketplace/1.0';

type GhContentItem = {
  type?: string;
  name?: string;
  path?: string;
  download_url?: string | null;
  encoding?: string;
  content?: string;
};

export type FetchAssistantPackageOptions = {
  signal?: AbortSignal;
};

async function fetchBytes(
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ status: number; ok: boolean; bytes: Uint8Array; finalUrl: string }> {
  try {
    const hop = await ssrfHttpGet(url, {
      allowPrivateNetwork: false,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes,
      rejectOversized: true,
      signal,
      headers: {
        Accept: 'application/vnd.github+json, application/json;q=0.9, */*;q=0.8',
        'User-Agent': USER_AGENT,
      },
    });
    return {
      status: hop.status,
      ok: hop.ok,
      bytes: hop.bytes,
      finalUrl: hop.finalUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (signal?.aborted || /aborted|AbortError/i.test(msg)) {
      throw new Error('import_aborted');
    }
    if (/timeout|TimeoutError/i.test(msg)) {
      throw new Error('下载超时，请检查网络后重试');
    }
    if (/SSRF|内网|本机|仅支持 http|无效 URL|不允许在 URL|无法解析|响应过大/i.test(msg)) {
      if (/SSRF|内网|本机/.test(msg)) {
        throw new Error('不能从内网或本机地址导入助手包');
      }
      if (/响应过大/.test(msg)) {
        throw new Error(maxBytes >= MAX_ARCHIVE_BYTES ? '助手包过大' : '助手包内文件过大');
      }
      throw new Error(msg);
    }
    throw new Error(`无法访问该地址：${msg}`);
  }
}

function httpErrorMessage(status: number, context: string): string {
  if (status === 404) return `${context}不存在（404）`;
  if (status === 401 || status === 403) {
    return `${context}需要公开仓库；私有仓库暂不支持（${status}）`;
  }
  if (status === 429) return 'GitHub 请求过于频繁，请稍后再试';
  return `${context}失败（HTTP ${status}）`;
}

async function downloadArchive(
  url: string,
  signal?: AbortSignal,
): Promise<AssistantPackageContents> {
  const res = await fetchBytes(url, MAX_ARCHIVE_BYTES, signal);
  if (!res.ok) throw new Error(httpErrorMessage(res.status, '下载助手包'));
  if (res.bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('助手包过大');
  const buf = Buffer.from(res.bytes);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-url-'));
  const file = path.join(tmp, 'package.okbot');
  try {
    fs.writeFileSync(file, buf);
    return readAssistantPackageArchive(file);
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetchBytes(url, MAX_TEXT_BYTES, signal);
  if (!res.ok) throw new Error(httpErrorMessage(res.status, '读取文件'));
  if (res.bytes.byteLength > MAX_TEXT_BYTES) throw new Error('助手包内文件过大');
  return Buffer.from(res.bytes).toString('utf8');
}

/** Resolve HEAD to a concrete branch name when possible. */
async function resolveRef(
  owner: string,
  repo: string,
  ref: string,
  signal?: AbortSignal,
): Promise<string> {
  if (ref !== 'HEAD') return ref;
  for (const candidate of ['main', 'master']) {
    const res = await fetchBytes(
      githubContentsApiUrl(owner, repo, '', candidate),
      MAX_TEXT_BYTES,
      signal,
    );
    if (res.ok) return candidate;
  }
  return 'main';
}

async function readGithubFile(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<string> {
  const apiUrl = githubContentsApiUrl(owner, repo, filePath, ref);
  const apiRes = await fetchBytes(apiUrl, MAX_TEXT_BYTES, signal);
  if (apiRes.ok) {
    const body = JSON.parse(Buffer.from(apiRes.bytes).toString('utf8')) as GhContentItem;
    if (typeof body.content === 'string' && body.encoding === 'base64') {
      return Buffer.from(body.content, 'base64').toString('utf8');
    }
    if (typeof body.download_url === 'string' && body.download_url) {
      return fetchText(body.download_url, signal);
    }
  }
  return fetchText(githubRawFileUrl(owner, repo, ref, filePath), signal);
}

async function loadPackageDir(
  owner: string,
  repo: string,
  refIn: string,
  dirPath: string,
  signal?: AbortSignal,
): Promise<AssistantPackageContents> {
  const ref = await resolveRef(owner, repo, refIn, signal);
  const manifestRel = dirPath ? `${dirPath}/manifest.json` : 'manifest.json';
  const manifestRaw = await readGithubFile(owner, repo, ref, manifestRel, signal);

  let agentsMd = '';
  try {
    agentsMd = await readGithubFile(
      owner,
      repo,
      ref,
      dirPath ? `${dirPath}/AGENTS.md` : 'AGENTS.md',
      signal,
    );
  } catch {
    /* optional */
  }

  const skillFiles: Array<{ slug: string; raw: string }> = [];
  const skillsPath = dirPath ? `${dirPath}/skills` : 'skills';
  const skillsRes = await fetchBytes(
    githubContentsApiUrl(owner, repo, skillsPath, ref),
    MAX_TEXT_BYTES,
    signal,
  );
  if (skillsRes.ok) {
    const listing = JSON.parse(Buffer.from(skillsRes.bytes).toString('utf8')) as
      | GhContentItem[]
      | GhContentItem;
    const items = Array.isArray(listing) ? listing : [];
    for (const item of items) {
      if (item.type !== 'dir' || !item.name) continue;
      const slug = item.name;
      try {
        const raw = await readGithubFile(
          owner,
          repo,
          ref,
          `${skillsPath}/${slug}/SKILL.md`,
          signal,
        );
        skillFiles.push({ slug, raw });
      } catch {
        /* skip */
      }
    }
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestRaw) as unknown;
  } catch {
    throw new Error('manifest.json 不是有效 JSON');
  }
  return parseAssistantPackage({ manifest, agentsMd, skillFiles });
}

async function discoverPackage(
  owner: string,
  repo: string,
  refIn: string,
  signal?: AbortSignal,
): Promise<AssistantPackageContents> {
  const ref = await resolveRef(owner, repo, refIn, signal);
  for (const known of GITHUB_ASSISTANT_KNOWN_PATHS) {
    try {
      return await loadPackageDir(owner, repo, ref, known, signal);
    } catch {
      /* try next */
    }
  }
  try {
    const rootRes = await fetchBytes(githubContentsApiUrl(owner, repo, '', ref), MAX_TEXT_BYTES, signal);
    if (rootRes.ok) {
      const listing = JSON.parse(Buffer.from(rootRes.bytes).toString('utf8')) as GhContentItem[];
      if (Array.isArray(listing)) {
        const asset = listing.find(
          (i) => i.type === 'file' && typeof i.name === 'string' && /\.okbot$/i.test(i.name),
        );
        if (asset?.download_url) return await downloadArchive(asset.download_url, signal);
      }
    }
  } catch {
    /* ignore */
  }
  throw new Error(
    `仓库里找不到助手包（需要 manifest.json 或 .okbot）。尝试过：${GITHUB_ASSISTANT_KNOWN_PATHS.map((p) => p || '/').join(', ')}`,
  );
}

async function fetchPlan(
  plan: GithubAssistantPlan,
  signal?: AbortSignal,
): Promise<AssistantPackageContents> {
  if (plan.kind === 'archive') return downloadArchive(plan.url, signal);
  if (plan.kind === 'dir') return loadPackageDir(plan.owner, plan.repo, plan.ref, plan.path, signal);
  return discoverPackage(plan.owner, plan.repo, plan.ref, signal);
}

/** Parse URL → download/parse package (does not install). */
export async function fetchAssistantPackageFromUrl(
  rawUrl: string,
  opts?: FetchAssistantPackageOptions,
): Promise<AssistantPackageContents> {
  if (opts?.signal?.aborted) throw new Error('import_aborted');
  const plan = parseGithubAssistantSource(rawUrl);
  return fetchPlan(plan, opts?.signal);
}
