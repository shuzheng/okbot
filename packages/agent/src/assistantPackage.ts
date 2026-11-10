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
 * Installable assistant package identity (in-memory).
 * On disk this lives in `bot.json` (name / description / avatar fields).
 * Secrets (API keys, tokens, session, memories) are never included.
 */
export type AssistantPackageManifest = {
  format: typeof OKBOT_ASSISTANT_PACKAGE_FORMAT;
  /** Package display name → bot roster name on import. */
  name: string;
  /** Short persona / description. */
  description: string;
  avatar: AssistantPackageAvatar;
  /** Optional SOUL.md body (personality / boundaries / tone). */
  soulMd?: string;
  /** Skills shipped with the package (slug → body already in skills/). */
  skills?: Array<{ slug: string; name: string; description: string }>;
  /** ISO timestamp when exported. */
  exportedAt?: string;
};

export type AssistantPackageContents = {
  manifest: AssistantPackageManifest;
  soulMd: string;
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

function normalizeAvatar(raw: Record<string, unknown> | null | undefined): AssistantPackageAvatar {
  const src = raw && typeof raw === 'object' ? raw : {};
  const nested =
    src.avatar && typeof src.avatar === 'object'
      ? (src.avatar as Record<string, unknown>)
      : null;
  const pick = nested ?? src;
  return {
    avatarKind: pick.avatarKind === 'emoji' ? 'emoji' : 'bot-avatar',
    emoji:
      typeof pick.emoji === 'string' && pick.emoji.trim() ? pick.emoji.trim() : '🤖',
    color: typeof pick.color === 'string' ? pick.color.trim() : '',
    ...(typeof pick.botAvatarType === 'string'
      ? { botAvatarType: pick.botAvatarType as AssistantPackageAvatar['botAvatarType'] }
      : {}),
  };
}

/** Share-package `bot.json` payload (name / description / full avatar; no secrets). */
export function assistantPackageBotJson(pkg: AssistantPackageContents): Record<string, unknown> {
  const { name, description, avatar } = pkg.manifest;
  return {
    name,
    description,
    avatarKind: avatar.avatarKind,
    emoji: avatar.emoji,
    color: avatar.color,
    ...(avatar.botAvatarType ? { botAvatarType: avatar.botAvatarType } : {}),
  };
}

export function buildAssistantPackage(input: {
  name: string;
  description: string;
  avatar: AssistantPackageAvatar;
  soulMd?: string;
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
    soulMd: (input.soulMd ?? '').trim() || undefined,
    skills: skills.map(({ slug, name, description }) => ({ slug, name, description })),
    exportedAt: new Date().toISOString(),
  });
  return {
    manifest,
    soulMd: (input.soulMd ?? '').trim(),
    skills,
  };
}

/** Validate + normalize a parsed package (folder or unzipped .okbot). Requires bot.json. */
export function parseAssistantPackage(raw: {
  /** Package identity + avatar from bot.json (required). */
  botJson: unknown;
  soulMd?: string;
  skillFiles?: Array<{ slug: string; raw: string }>;
}): AssistantPackageContents {
  if (!raw.botJson || typeof raw.botJson !== 'object') {
    throw new Error('无效的助手包：缺少 bot.json');
  }
  const botSrc = raw.botJson as Record<string, unknown>;
  if ('format' in botSrc && botSrc.format != null && botSrc.format !== OKBOT_ASSISTANT_PACKAGE_FORMAT) {
    throw new Error(`无效的助手包格式（bot.json）：${String(botSrc.format)}`);
  }

  const name = typeof botSrc.name === 'string' ? botSrc.name.trim() : '';
  if (!name) throw new Error('无效的助手包：缺少 name');
  const description =
    typeof botSrc.description === 'string' ? botSrc.description.trim() : '';
  const avatar = normalizeAvatar(botSrc);

  const skills: BotSkill[] = [];
  for (const f of raw.skillFiles ?? []) {
    const slug = (f.slug || '').trim();
    if (!slug) continue;
    skills.push(parseSkillMarkdown(slug, f.raw));
  }

  const soulMd =
    typeof raw.soulMd === 'string'
      ? raw.soulMd
      : typeof (raw as { agentsMd?: unknown }).agentsMd === 'string'
        ? ((raw as { agentsMd?: string }).agentsMd as string)
        : '';

  return buildAssistantPackage({
    name,
    description,
    avatar,
    soulMd,
    skills,
  });
}

/** File map for writing a package folder (paths relative to package root). */
export function assistantPackageToFileMap(
  pkg: AssistantPackageContents,
): Record<string, string> {
  const files: Record<string, string> = {
    'bot.json': `${JSON.stringify(assistantPackageBotJson(pkg), null, 2)}\n`,
  };
  if (pkg.soulMd.trim()) {
    files['SOUL.md'] = pkg.soulMd.endsWith('\n') ? pkg.soulMd : `${pkg.soulMd}\n`;
  }
  for (const skill of pkg.skills) {
    files[`skills/${skill.slug}/SKILL.md`] = formatSkillMarkdown(skill);
  }
  return files;
}
