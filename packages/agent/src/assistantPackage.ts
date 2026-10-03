import type {
  BotAvatarKind,
  BotAvatarShape,
  BotSkill,
} from '@okbot/shared';
import { formatSkillMarkdown, parseSkillMarkdown } from './skills/parse.js';

/** Package format id (no product version numbers). */
export const OKBOT_ASSISTANT_PACKAGE_FORMAT = 'okbot-assistant' as const;

export type AssistantPackageAvatar = {
  avatarKind: BotAvatarKind;
  emoji: string;
  color: string;
  botAvatarType?: BotAvatarShape;
};

/**
 * Installable assistant package (folder or .okbot zip contents).
 * Secrets (API keys, tokens, session, memories) are never included.
 */
export type AssistantPackageManifest = {
  format: typeof OKBOT_ASSISTANT_PACKAGE_FORMAT;
  /** Package display name → bot roster name on import. */
  name: string;
  /** Short persona / description. */
  description: string;
  avatar: AssistantPackageAvatar;
  /** Optional AGENTS.md body (persona instructions). */
  agentsMd?: string;
  /** Skills shipped with the package (slug → body already in skills/). */
  skills?: Array<{ slug: string; name: string; description: string }>;
  /** ISO timestamp when exported. */
  exportedAt?: string;
};

export type AssistantPackageContents = {
  manifest: AssistantPackageManifest;
  agentsMd: string;
  skills: BotSkill[];
};

/** Keys / path segments that must never be exported. */
export const ASSISTANT_PACKAGE_SECRET_KEYS = [
  'apiKey',
  'api_key',
  'token',
  'accessToken',
  'secret',
  'password',
  'authorization',
  'SANDBOX_TOKEN',
  'OKBOT_API_KEY',
] as const;

const SECRET_KEY_RE = /^(api[_-]?key|token|access[_-]?token|secret|password|authorization)$/i;

/** Deep-strip secret-looking keys from a plain object (export hygiene). */
export function stripSecrets<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripSecrets(v)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) continue;
    if (ASSISTANT_PACKAGE_SECRET_KEYS.some((s) => s.toLowerCase() === k.toLowerCase())) continue;
    out[k] = stripSecrets(v);
  }
  return out as T;
}

export function buildAssistantPackage(input: {
  name: string;
  description: string;
  avatar: AssistantPackageAvatar;
  agentsMd?: string;
  skills?: BotSkill[];
}): AssistantPackageContents {
  const skills = (input.skills ?? []).map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    body: s.body,
  }));
  const manifest: AssistantPackageManifest = stripSecrets({
    format: OKBOT_ASSISTANT_PACKAGE_FORMAT,
    name: input.name.trim() || '未命名助手',
    description: (input.description ?? '').trim(),
    avatar: {
      avatarKind: input.avatar.avatarKind === 'emoji' ? 'emoji' : 'bot-avatar',
      emoji: input.avatar.emoji?.trim() || '🤖',
      color: input.avatar.color || '',
      ...(input.avatar.botAvatarType
        ? { botAvatarType: input.avatar.botAvatarType }
        : {}),
    },
    agentsMd: (input.agentsMd ?? '').trim() || undefined,
    skills: skills.map(({ slug, name, description }) => ({ slug, name, description })),
    exportedAt: new Date().toISOString(),
  });
  return {
    manifest,
    agentsMd: (input.agentsMd ?? '').trim(),
    skills,
  };
}

/** Validate + normalize a parsed package (folder or unzipped .okbot). */
export function parseAssistantPackage(raw: {
  manifest: unknown;
  agentsMd?: string;
  skillFiles?: Array<{ slug: string; raw: string }>;
}): AssistantPackageContents {
  const m = raw.manifest;
  if (!m || typeof m !== 'object') throw new Error('无效的助手包：缺少 manifest');
  const src = m as Record<string, unknown>;
  if (src.format !== OKBOT_ASSISTANT_PACKAGE_FORMAT) {
    throw new Error(`无效的助手包格式：${String(src.format ?? '')}`);
  }
  const name = typeof src.name === 'string' ? src.name.trim() : '';
  if (!name) throw new Error('无效的助手包：缺少 name');
  const description = typeof src.description === 'string' ? src.description.trim() : '';
  const avatarRaw =
    src.avatar && typeof src.avatar === 'object'
      ? (src.avatar as Record<string, unknown>)
      : {};
  const avatar: AssistantPackageAvatar = {
    avatarKind: avatarRaw.avatarKind === 'emoji' ? 'emoji' : 'bot-avatar',
    emoji: typeof avatarRaw.emoji === 'string' && avatarRaw.emoji.trim() ? avatarRaw.emoji.trim() : '🤖',
    color: typeof avatarRaw.color === 'string' ? avatarRaw.color.trim() : '',
    ...(typeof avatarRaw.botAvatarType === 'string'
      ? { botAvatarType: avatarRaw.botAvatarType as AssistantPackageAvatar['botAvatarType'] }
      : {}),
  };

  const skills: BotSkill[] = [];
  for (const f of raw.skillFiles ?? []) {
    const slug = (f.slug || '').trim();
    if (!slug) continue;
    skills.push(parseSkillMarkdown(slug, f.raw));
  }

  const agentsMd =
    typeof raw.agentsMd === 'string'
      ? raw.agentsMd
      : typeof src.agentsMd === 'string'
        ? src.agentsMd
        : '';

  return buildAssistantPackage({
    name,
    description,
    avatar,
    agentsMd,
    skills,
  });
}

/** File map for writing a package folder (paths relative to package root). */
export function assistantPackageToFileMap(
  pkg: AssistantPackageContents,
): Record<string, string> {
  const files: Record<string, string> = {
    'manifest.json': `${JSON.stringify(pkg.manifest, null, 2)}\n`,
  };
  if (pkg.agentsMd.trim()) {
    files['AGENTS.md'] = pkg.agentsMd.endsWith('\n') ? pkg.agentsMd : `${pkg.agentsMd}\n`;
  }
  for (const skill of pkg.skills) {
    files[`skills/${skill.slug}/SKILL.md`] = formatSkillMarkdown(skill);
  }
  return files;
}
