import fs from 'node:fs';
import path from 'node:path';
import {
  createOwnerResourceRecord,
  createUlid,
  isUlid,
  mimeForResourceType,
  normalizeOwnerResourceRecord,
  resourceDisplayTitle,
  type OwnerResourceCreatedBy,
  type OwnerResourceInfo,
  type OwnerResourceRecord,
  type OwnerResourceType,
} from '@okbot/shared';
import { assertWritable, ensureDir } from './fs';
import type { OwnerLifecycle } from './ownerLifecycle';

export type ResourceStoreDeps = {
  ownerDir(ownerId: string): string;
  ensureOwnerLayout(ownerId: string): void;
  ownerResourcesDir(ownerId: string): string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function writeJsonlAtomic(file: string, lines: string[]): void {
  assertWritable(file);
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  const body = lines.length ? `${lines.join('\n')}\n` : '';
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
}

function isPathInside(parent: string, child: string): boolean {
  const root = path.resolve(parent);
  const target = path.resolve(child);
  if (target === root) return true;
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Per-owner durable resources library at `~/.okbot/data/<owner>/resources.jsonl`.
 * One JSON object per line. Whole-file rewrite (same spirit as tasks.jsonl).
 * Breaking: does NOT scan or migrate ad-hoc files already in resources/.
 */
export class ResourceStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: ResourceStoreDeps,
  ) {}

  private jsonl(ownerId: string): string {
    return path.join(this.deps.ownerDir(ownerId), 'resources.jsonl');
  }

  /** Load all records (newest updatedAt first when enriched for UI). */
  loadAll(ownerId: string): OwnerResourceRecord[] {
    const file = this.jsonl(ownerId);
    if (!fs.existsSync(file)) return [];
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const out: OwnerResourceRecord[] = [];
    const seen = new Set<string>();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const rec = normalizeOwnerResourceRecord(parsed, i);
      if (!rec) continue;
      let id = rec.id;
      if (seen.has(id)) id = `${id}_${i + 1}`;
      seen.add(id);
      out.push(id === rec.id ? rec : { ...rec, id });
    }
    return out;
  }

  private persist(ownerId: string, records: OwnerResourceRecord[]): OwnerResourceRecord[] {
    this.deps.ensureOwnerLayout(ownerId);
    this.life.assertOwnerAlive(ownerId);
    ensureDir(path.dirname(this.jsonl(ownerId)));
    writeJsonlAtomic(
      this.jsonl(ownerId),
      records.map((r) => JSON.stringify(r)),
    );
    return records;
  }

  enrich(ownerId: string, rec: OwnerResourceRecord): OwnerResourceInfo {
    const resourcesDir = this.deps.ownerResourcesDir(ownerId);
    const rawName = (rec.title || '').trim() || path.basename(rec.path) || rec.path;
    const name = resourceDisplayTitle(rawName, rec.type, rec.path);
    const info: OwnerResourceInfo = {
      ...rec,
      name,
      mime: mimeForResourceType(rec.type),
    };
    if (rec.type === 'url') {
      info.ingested = false;
      return info;
    }
    const abs = path.resolve(rec.path);
    const ingested =
      rec.type !== 'folder' && isPathInside(resourcesDir, abs) && fs.existsSync(abs);
    info.ingested = ingested || (rec.type !== 'folder' && isPathInside(resourcesDir, abs));
    if (info.ingested) {
      const fileName = path.basename(abs);
      info.assetRel = `${ownerId}/resources/${fileName}`;
    }
    try {
      if (rec.type !== 'url' && fs.existsSync(abs)) {
        const st = fs.statSync(abs);
        if (st.isFile()) info.size = st.size;
      }
    } catch {
      /* ignore */
    }
    return info;
  }

  list(ownerId: string): OwnerResourceInfo[] {
    const all = this.loadAll(ownerId).map((r) => this.enrich(ownerId, r));
    all.sort(
      (a, b) =>
        (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') ||
        b.id.localeCompare(a.id),
    );
    return all;
  }

  get(ownerId: string, resourceId: string): OwnerResourceRecord | null {
    const id = (resourceId || '').trim();
    if (!id) return null;
    return this.loadAll(ownerId).find((r) => r.id === id) || null;
  }

  add(
    ownerId: string,
    input: {
      id?: string;
      type?: OwnerResourceType;
      title?: string;
      path: string;
      sourceMessageId?: string;
      createdBy?: OwnerResourceCreatedBy;
      tags?: string[];
    },
  ): OwnerResourceRecord {
    const all = this.loadAll(ownerId);
    let rec = createOwnerResourceRecord(input);
    if (all.some((r) => r.id === rec.id)) {
      rec = { ...rec, id: createUlid() };
    }
    this.persist(ownerId, [...all, rec]);
    return rec;
  }

  update(
    ownerId: string,
    resourceId: string,
    patch: { title?: string; tags?: string[] | null },
  ): OwnerResourceRecord {
    const id = (resourceId || '').trim();
    if (!id) throw new Error('需要资源 id');
    const all = this.loadAll(ownerId);
    const idx = all.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`找不到资源「${id}」`);
    const prev = all[idx]!;
    const next: OwnerResourceRecord = { ...prev, updatedAt: nowIso() };
    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (t) next.title = t;
      else delete next.title;
    }
    if (patch.tags === null) {
      delete next.tags;
    } else if (patch.tags) {
      const tags = patch.tags.map((x) => x.trim()).filter(Boolean).slice(0, 32);
      if (tags.length) next.tags = tags;
      else delete next.tags;
    }
    const out = all.slice();
    out[idx] = next;
    this.persist(ownerId, out);
    return next;
  }

  /**
   * Delete metadata. If the file lives under this owner's resources/, also unlink it.
   * External folder/file links and URLs: metadata only.
   */
  delete(ownerId: string, resourceId: string): void {
    const id = (resourceId || '').trim();
    if (!id) throw new Error('需要资源 id');
    const all = this.loadAll(ownerId);
    const idx = all.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`找不到资源「${id}」`);
    const prev = all[idx]!;
    const resourcesDir = this.deps.ownerResourcesDir(ownerId);
    if (prev.type !== 'url' && prev.type !== 'folder') {
      try {
        const abs = path.resolve(prev.path);
        if (isPathInside(resourcesDir, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          fs.unlinkSync(abs);
        }
      } catch {
        /* best-effort file delete */
      }
    }
    const next = all.slice();
    next.splice(idx, 1);
    this.persist(ownerId, next);
  }

  /**
   * Index a file already written under resources/ (e.g. generate_image).
   * Idempotent on same absolute path: updates title/updatedAt if present.
   */
  indexIngestedFile(
    ownerId: string,
    input: {
      filePath: string;
      title?: string;
      createdBy?: OwnerResourceCreatedBy;
      sourceMessageId?: string;
      type?: OwnerResourceType;
    },
  ): OwnerResourceRecord {
    const abs = path.resolve((input.filePath || '').trim());
    const resourcesDir = this.deps.ownerResourcesDir(ownerId);
    if (!isPathInside(resourcesDir, abs)) {
      throw new Error('indexIngestedFile: path must be under owner resources/');
    }
    const all = this.loadAll(ownerId);
    const existing = all.findIndex((r) => path.resolve(r.path) === abs);
    if (existing >= 0) {
      const prev = all[existing]!;
      const next: OwnerResourceRecord = {
        ...prev,
        updatedAt: nowIso(),
      };
      if (input.title?.trim()) next.title = input.title.trim();
      if (input.sourceMessageId?.trim()) next.sourceMessageId = input.sourceMessageId.trim();
      const out = all.slice();
      out[existing] = next;
      this.persist(ownerId, out);
      return next;
    }
    return this.add(ownerId, {
      type: input.type,
      title: input.title,
      path: abs,
      createdBy: input.createdBy ?? 'assistant',
      sourceMessageId: input.sourceMessageId,
    });
  }

  /**
   * Copy a local file into resources/ and index it. Returns the new record.
   */
  ingestFile(
    ownerId: string,
    input: {
      sourcePath: string;
      title?: string;
      createdBy?: OwnerResourceCreatedBy;
      sourceMessageId?: string;
    },
  ): OwnerResourceRecord {
    const src = path.resolve((input.sourcePath || '').trim());
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
      throw new Error('源文件不存在');
    }
    const resourcesDir = this.deps.ownerResourcesDir(ownerId);
    ensureDir(resourcesDir);
    const base = path.basename(src);
    const safeBase =
      base
        .replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]+/g, '_')
        .replace(/^[._]+/, '')
        .slice(0, 120) || 'file';
    const unique = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${safeBase}`;
    const dest = path.join(resourcesDir, unique);
    fs.copyFileSync(src, dest);
    return this.add(ownerId, {
      title: input.title || base,
      path: dest,
      createdBy: input.createdBy ?? 'user',
      sourceMessageId: input.sourceMessageId,
    });
  }

  /** Default self-contained HTML shell for a new note. */
  static defaultNoteHtml(title: string, bodyHtml = '<p></p>'): string {
    const safeTitle = (title || '未命名笔记').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --fg: #1a1a1a; --muted: #666; --card: #fff; --border: #e5e5e5; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #121212; --fg: #f2f2f2; --muted: #a3a3a3; --card: #1e1e1e; --border: #333; --accent: #60a5fa; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Noto Sans SC", sans-serif; background: var(--bg); color: var(--fg); }
  main { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 1.75rem; font-weight: 650; margin: 0 0 0.75rem; letter-spacing: -0.02em; }
  h2 { font-size: 1.25rem; margin: 1.75rem 0 0.5rem; }
  h3 { font-size: 1.05rem; margin: 1.25rem 0 0.4rem; }
  p, li { color: var(--fg); }
  .muted { color: var(--muted); font-size: 0.9rem; }
  section { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; margin: 12px 0; }
  a { color: var(--accent); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
  pre { overflow: auto; padding: 12px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); }
  ul { padding-left: 1.25rem; }
</style>
</head>
<body>
<main>
  <h1>${safeTitle}</h1>
  ${bodyHtml}
</main>
</body>
</html>
`;
  }

  /** Create an HTML note under resources/ and index it (`type=note`). */
  addNote(
    ownerId: string,
    input: {
      title?: string;
      body?: string;
      html?: string;
      createdBy?: OwnerResourceCreatedBy;
      sourceMessageId?: string;
      id?: string;
    },
  ): OwnerResourceRecord {
    const resourcesDir = this.deps.ownerResourcesDir(ownerId);
    ensureDir(resourcesDir);
    // Only ULID ids may influence the filesystem name (blocks path traversal).
    const idRaw = (input.id || '').trim();
    const id = isUlid(idRaw) ? idRaw : createUlid();
    const title = (input.title || '').trim() || '未命名笔记';
    const safe =
      title
        .replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]+/g, '_')
        .replace(/^[._]+/, '')
        .slice(0, 80) || 'note';
    const fileName = `${id.slice(0, 10)}_${safe}.html`;
    const dest = path.resolve(resourcesDir, path.basename(fileName));
    if (!isPathInside(resourcesDir, dest)) {
      throw new Error('笔记路径不合法');
    }
    const html =
      (input.html || '').trim() ||
      (input.body || '').trim() ||
      ResourceStore.defaultNoteHtml(title);
    fs.writeFileSync(dest, html, 'utf8');
    return this.add(ownerId, {
      id,
      type: 'note',
      title,
      path: dest,
      createdBy: input.createdBy ?? 'user',
      sourceMessageId: input.sourceMessageId,
    });
  }

  /**
   * Create or update an HTML note. Update by id or absolute path under resources/.
   * 「维护」= update the same file (html + optional title).
   */
  upsertNote(
    ownerId: string,
    input: {
      id?: string;
      path?: string;
      title?: string;
      html: string;
      createdBy?: OwnerResourceCreatedBy;
      sourceMessageId?: string;
    },
  ): OwnerResourceRecord {
    const html = (input.html || '').trim();
    if (!html) throw new Error('笔记需要 html 正文');
    const id = (input.id || '').trim();
    const pathHint = (input.path || '').trim();
    const all = this.loadAll(ownerId);
    let idx = -1;
    if (id) idx = all.findIndex((r) => r.id === id);
    if (idx < 0 && pathHint) {
      const abs = path.resolve(pathHint);
      idx = all.findIndex((r) => r.type === 'note' && path.resolve(r.path) === abs);
    }
    if (idx >= 0) {
      const prev = all[idx]!;
      if (prev.type !== 'note') throw new Error('目标资源不是笔记');
      const abs = path.resolve(prev.path);
      const resourcesDir = this.deps.ownerResourcesDir(ownerId);
      if (!isPathInside(resourcesDir, abs)) {
        throw new Error('只能更新资料库内的笔记文件');
      }
      ensureDir(path.dirname(abs));
      fs.writeFileSync(abs, html, 'utf8');
      const next: OwnerResourceRecord = {
        ...prev,
        updatedAt: nowIso(),
      };
      if (input.title?.trim()) next.title = input.title.trim();
      if (input.sourceMessageId?.trim()) next.sourceMessageId = input.sourceMessageId.trim();
      const out = all.slice();
      out[idx] = next;
      this.persist(ownerId, out);
      return next;
    }
    // Miss: prefer error over create-with-caller-id (closes traversal / confused deputy).
    if (id || pathHint) {
      throw new Error(id ? `找不到笔记「${id}」` : '找不到笔记');
    }
    return this.addNote(ownerId, {
      title: input.title,
      html,
      createdBy: input.createdBy ?? 'assistant',
      sourceMessageId: input.sourceMessageId,
    });
  }

  /** Overwrite text/html body of an ingested resource (notes + text files). */
  writeText(ownerId: string, resourceId: string, text: string): OwnerResourceRecord {
    const rec = this.get(ownerId, resourceId);
    if (!rec) throw new Error('找不到资源');
    if (rec.type === 'url' || rec.type === 'folder') {
      throw new Error('该类型不可写入正文');
    }
    const abs = path.resolve(rec.path);
    const resourcesDir = this.deps.ownerResourcesDir(ownerId);
    if (!isPathInside(resourcesDir, abs)) {
      throw new Error('只能写入资料库内的文件');
    }
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, text, 'utf8');
    return this.update(ownerId, resourceId, {});
  }

  /** Metadata-only link to an absolute folder or file, or a URL. */
  addLink(
    ownerId: string,
    input: {
      kind: 'url' | 'folder' | 'file';
      target: string;
      title?: string;
      createdBy?: OwnerResourceCreatedBy;
    },
  ): OwnerResourceRecord {
    const target = (input.target || '').trim();
    if (!target) throw new Error('需要链接目标');
    if (input.kind === 'url') {
      if (!/^https?:\/\//i.test(target)) throw new Error('URL 须以 http(s):// 开头');
      return this.add(ownerId, {
        type: 'url',
        title: input.title,
        path: target,
        createdBy: input.createdBy ?? 'user',
      });
    }
    const abs = path.resolve(target);
    if (!fs.existsSync(abs)) throw new Error('路径不存在');
    const st = fs.statSync(abs);
    if (input.kind === 'folder') {
      if (!st.isDirectory()) throw new Error('不是文件夹');
      return this.add(ownerId, {
        type: 'folder',
        title: input.title || path.basename(abs),
        path: abs,
        createdBy: input.createdBy ?? 'user',
      });
    }
    if (!st.isFile()) throw new Error('不是文件');
    return this.add(ownerId, {
      title: input.title || path.basename(abs),
      path: abs,
      createdBy: input.createdBy ?? 'user',
    });
  }

  /** Read text body for preview (md / code / text). Size-capped. */
  readText(ownerId: string, resourceId: string, maxBytes = 512 * 1024): string {
    const rec = this.get(ownerId, resourceId);
    if (!rec) throw new Error('找不到资源');
    if (rec.type === 'url' || rec.type === 'folder') {
      throw new Error('该类型无可预览正文');
    }
    const abs = path.resolve(rec.path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error('文件不存在');
    }
    const st = fs.statSync(abs);
    if (st.size > maxBytes) throw new Error('文件过大，无法预览');
    return fs.readFileSync(abs, 'utf8');
  }

  clear(ownerId: string): void {
    const file = this.jsonl(ownerId);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}
