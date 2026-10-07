/**
 * Resolve user-entered GitHub / raw URLs into a fetch plan for assistant packages.
 * No tokens or secrets — public sources only. Fetch itself lives in the desktop host.
 */

/** Known relative dirs under a repo that often hold an OkBot assistant package. */
export const GITHUB_ASSISTANT_KNOWN_PATHS = [
  '',
  'assistant',
  'assistant-package',
  'okbot-assistant',
  '.okbot',
  'okbot',
] as const;

export type GithubAssistantPlan =
  | {
      kind: 'archive';
      /** Direct download URL for a .okbot / .zip file. */
      url: string;
      label: string;
    }
  | {
      kind: 'dir';
      owner: string;
      repo: string;
      ref: string;
      /** Directory that should contain manifest.json ('' = repo root). */
      path: string;
      label: string;
    }
  | {
      kind: 'discover';
      owner: string;
      repo: string;
      ref: string;
      label: string;
    };

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** True when the path looks like a zip / .okbot archive. */
export function isAssistantArchivePath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith('.okbot') || lower.endsWith('.zip');
}

/**
 * Parse a user source string into a fetch plan.
 * Accepts: repo URL, tree/blob URL, raw.githubusercontent.com, release asset, direct .okbot URL.
 */
export function parseGithubAssistantSource(raw: string): GithubAssistantPlan {
  const trimmed = (raw || '').trim();
  if (!trimmed) throw new Error('请输入 GitHub 地址或助手包链接');

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('地址无效，请粘贴完整的 https 链接');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('只支持 http(s) 链接');
  }
  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split('/').filter(Boolean).map(decodePath);

  // Direct archive on non-github hosts (or already-raw / release CDN handled below).
  // github.com /blob/…/*.okbot must become a raw URL — the blob page is HTML.
  const isGithubHost = host === 'github.com' || host === 'www.github.com';
  if (isAssistantArchivePath(url.pathname) && !isGithubHost) {
    const name = pathParts[pathParts.length - 1] || 'package.okbot';
    return { kind: 'archive', url: url.toString(), label: name };
  }

  // raw.githubusercontent.com/owner/repo/ref/path...
  if (host === 'raw.githubusercontent.com') {
    if (pathParts.length < 3) throw new Error('raw 链接不完整');
    const [owner, repo, ref, ...rest] = pathParts;
    const rel = rest.join('/');
    if (!rel || rel === 'manifest.json' || rel.endsWith('/manifest.json')) {
      const dir = rel === 'manifest.json' || !rel ? '' : rel.replace(/\/manifest\.json$/i, '');
      return {
        kind: 'dir',
        owner: owner!,
        repo: repo!,
        ref: ref!,
        path: dir,
        label: `${owner}/${repo}${dir ? `/${dir}` : ''}`,
      };
    }
    // Treat other raw files as archive only when extension matches; else as package dir parent
    if (isAssistantArchivePath(rel)) {
      return { kind: 'archive', url: url.toString(), label: rest[rest.length - 1]! };
    }
    const dir = rel.includes('/') ? rel.replace(/\/[^/]+$/, '') : '';
    return {
      kind: 'dir',
      owner: owner!,
      repo: repo!,
      ref: ref!,
      path: dir,
      label: `${owner}/${repo}${dir ? `/${dir}` : ''}`,
    };
  }

  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new Error('请使用 GitHub 仓库、raw 文件或 .okbot 直链');
  }

  if (pathParts.length < 2) throw new Error('GitHub 地址缺少 owner/repo');
  const owner = pathParts[0]!;
  const repo = pathParts[1]!.replace(/\.git$/i, '');

  // /owner/repo/releases/download/<tag>/<asset>
  if (pathParts[2] === 'releases' && pathParts[3] === 'download' && pathParts.length >= 6) {
    const tag = pathParts[4]!;
    const assetParts = pathParts.slice(5);
    const asset = assetParts.join('/');
    if (!isAssistantArchivePath(asset)) {
      throw new Error('发布资源需要是 .okbot 或 .zip 文件');
    }
    const assetUrl = assetParts.map(encodeURIComponent).join('/');
    return {
      kind: 'archive',
      url: `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag).replace(/%2F/gi, '/')}/${assetUrl}`,
      label: assetParts[assetParts.length - 1]!,
    };
  }

  // /owner/repo/archive/refs/heads/main.zip or /archive/v1.0.0.zip — not a package by itself
  if (pathParts[2] === 'archive') {
    throw new Error('请指向助手包目录、manifest.json 或 .okbot 文件，而不是整个仓库压缩包');
  }

  // /owner/repo/tree/ref/path... or /blob/ref/path...
  if ((pathParts[2] === 'tree' || pathParts[2] === 'blob') && pathParts.length >= 4) {
    const ref = pathParts[3]!;
    let rel = pathParts.slice(4).join('/');
    if (pathParts[2] === 'blob' && /manifest\.json$/i.test(rel)) {
      rel = rel.replace(/\/?manifest\.json$/i, '');
    }
    if (pathParts[2] === 'blob' && isAssistantArchivePath(rel)) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rel.split('/').map(encodeURIComponent).join('/')}`;
      return { kind: 'archive', url: rawUrl, label: pathParts[pathParts.length - 1]! };
    }
    if (!rel) {
      return { kind: 'discover', owner, repo, ref, label: `${owner}/${repo}@${ref}` };
    }
    return { kind: 'dir', owner, repo, ref, path: stripTrailingSlash(rel), label: `${owner}/${repo}/${rel}` };
  }

  // /owner/repo[/]  → discover on default branch tip via HEAD
  if (pathParts.length === 2) {
    return { kind: 'discover', owner, repo, ref: 'HEAD', label: `${owner}/${repo}` };
  }

  throw new Error('无法识别该 GitHub 地址，请使用仓库、目录或 .okbot 直链');
}

/** Build raw.githubusercontent.com URL for a file inside a repo. */
export function githubRawFileUrl(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
): string {
  const rel = filePath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  const r = encodeURIComponent(ref).replace(/%2F/gi, '/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${r}/${rel}`;
}

/** GitHub Contents API URL for a path (file or directory listing). */
export function githubContentsApiUrl(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): string {
  const rel = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${rel ? `/${rel}` : ''}`;
  const q = ref && ref !== 'HEAD' ? `?ref=${encodeURIComponent(ref)}` : '';
  return `${base}${q}`;
}
