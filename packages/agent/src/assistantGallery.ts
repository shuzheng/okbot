/**
 * Built-in starter assistants ("assistant marketplace").
 * Packages live under packages/agent/gallery/<id>/{zh,en}/ (manifest + bot.json + SOUL.md + skills/).
 * Same format as `.okbot` import; install goes through the one package install path.
 * Shipped offline: gallery dir is copied next to the agent package and into desktop resources.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAssistantPackage,
  type AssistantPackageContents,
} from './assistantPackage.js';

export type GalleryLang = 'zh' | 'en';

/** Card data for the marketplace UI. */
export type AssistantGalleryItem = {
  id: string;
  emoji: string;
  color: string;
  name: string;
  description: string;
  skillNames: string[];
};

/** Stable marketplace order (must match gallery/order.json). */
export const GALLERY_ORDER = [
  'coder',
  'writer',
  'tutor',
  'planner',
  'translator',
  'computer-helper',
] as const;

let cachedRoot: string | null | undefined;

/**
 * Resolve the bundled gallery root (offline, no network).
 * Override with OKBOT_GALLERY_DIR for tests.
 */
export function resolveGalleryRoot(): string {
  if (cachedRoot !== undefined && cachedRoot !== null) return cachedRoot;
  const fromEnv = (process.env.OKBOT_GALLERY_DIR || '').trim();
  if (fromEnv && fs.existsSync(path.join(fromEnv, 'order.json'))) {
    cachedRoot = path.resolve(fromEnv);
    return cachedRoot;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [
    // Source / dist sibling: packages/agent/gallery
    path.resolve(here, '../gallery'),
    path.resolve(here, '../../gallery'),
    // Copied next to compiled agent entry
    path.resolve(here, 'gallery'),
    // Electron packaged: Resources/assistant-gallery
    ...(() => {
      const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
      return typeof resourcesPath === 'string' && resourcesPath
        ? [path.join(resourcesPath, 'assistant-gallery')]
        : [];
    })(),
    // Electron app path / vite out → apps/desktop/resources/assistant-gallery
    path.resolve(here, '../assistant-gallery'),
    path.resolve(here, '../../resources/assistant-gallery'),
    path.resolve(here, '../../../resources/assistant-gallery'),
  ];
  // Walk up looking for packages/agent/gallery (monorepo / bundled main)
  {
    let dir = here;
    for (let i = 0; i < 8; i++) {
      candidates.push(path.join(dir, 'packages/agent/gallery'));
      candidates.push(path.join(dir, 'gallery'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'order.json'))) {
      cachedRoot = c;
      return c;
    }
  }

  cachedRoot = path.resolve(here, '../gallery');
  return cachedRoot;
}

/** Clear cached root (tests). */
export function resetGalleryRootCache(): void {
  cachedRoot = undefined;
}

function readOrder(root: string): string[] {
  const orderPath = path.join(root, 'order.json');
  if (!fs.existsSync(orderPath)) {
    return [...GALLERY_ORDER];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(orderPath, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [...GALLERY_ORDER];
    const ids = raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    return ids.length ? ids : [...GALLERY_ORDER];
  } catch {
    return [...GALLERY_ORDER];
  }
}

function packDir(root: string, id: string, lang: GalleryLang): string {
  return path.join(root, id, lang === 'en' ? 'en' : 'zh');
}

/** Load one locale pack from disk (trusted bundled tree). */
export function loadGalleryPackageDir(dir: string): AssistantPackageContents {
  const root = path.resolve(dir);
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`gallery pack missing manifest.json: ${root}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  let soulMd = '';
  const soulPath = path.join(root, 'SOUL.md');
  const legacyAgentsPath = path.join(root, 'AGENTS.md');
  if (fs.existsSync(soulPath)) {
    soulMd = fs.readFileSync(soulPath, 'utf8');
  } else if (fs.existsSync(legacyAgentsPath)) {
    soulMd = fs.readFileSync(legacyAgentsPath, 'utf8');
  }
  let botJson: unknown;
  const botJsonPath = path.join(root, 'bot.json');
  if (fs.existsSync(botJsonPath)) {
    botJson = JSON.parse(fs.readFileSync(botJsonPath, 'utf8')) as unknown;
  }
  const skillFiles: Array<{ slug: string; raw: string }> = [];
  const skillsRoot = path.join(root, 'skills');
  if (fs.existsSync(skillsRoot) && fs.statSync(skillsRoot).isDirectory()) {
    for (const name of fs.readdirSync(skillsRoot)) {
      const skillFile = path.join(skillsRoot, name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      skillFiles.push({ slug: name, raw: fs.readFileSync(skillFile, 'utf8') });
    }
  }
  return parseAssistantPackage({ manifest, soulMd, skillFiles, botJson });
}

function avatarFromPkg(pkg: AssistantPackageContents): { emoji: string; color: string } {
  return {
    emoji: pkg.manifest.avatar.emoji || '🤖',
    color: pkg.manifest.avatar.color || '',
  };
}

export function listAssistantGallery(lang: GalleryLang = 'zh'): AssistantGalleryItem[] {
  const root = resolveGalleryRoot();
  const order = readOrder(root);
  const items: AssistantGalleryItem[] = [];
  for (const id of order) {
    const dir = packDir(root, id, lang);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
    try {
      const pkg = loadGalleryPackageDir(dir);
      const { emoji, color } = avatarFromPkg(pkg);
      items.push({
        id,
        emoji,
        color,
        name: pkg.manifest.name,
        description: pkg.manifest.description,
        skillNames: pkg.skills.map((s) => s.name),
      });
    } catch {
      // skip broken pack
    }
  }
  return items;
}

/** Package contents for one gallery entry, or null for an unknown id. */
export function galleryAssistantPackage(
  id: string,
  lang: GalleryLang = 'zh',
): AssistantPackageContents | null {
  const clean = (id || '').trim();
  if (!clean) return null;
  const root = resolveGalleryRoot();
  const dir = packDir(root, clean, lang);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) return null;
  try {
    return loadGalleryPackageDir(dir);
  } catch {
    return null;
  }
}
