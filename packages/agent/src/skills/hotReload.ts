import fs from 'node:fs';
import path from 'node:path';

export type SkillHotReloadChange = {
  botId: string | null;
  /** Absolute paths that changed (best-effort). */
  paths: string[];
  at: string;
};

export type SkillHotReloadOptions = {
  /** Absolute bot skills dir: ~/.okbot/<botId>/skills */
  botSkillsDir: string;
  botId: string;
  /** Absolute global skills dir: ~/.agents/skills (optional). */
  globalSkillsDir?: string | null;
  onChange: (change: SkillHotReloadChange) => void;
  /** Debounce window in ms (default 120). */
  debounceMs?: number;
};

/**
 * Watch skill directories and notify on change without app restart.
 * Next chat turn / read_skill already re-reads disk; this pushes UI + catalog refresh.
 */
export function watchSkillDirs(options: SkillHotReloadOptions): () => void {
  const debounceMs = options.debounceMs ?? 120;
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Set<string>();

  const flush = () => {
    timer = null;
    if (!pending.size) return;
    const paths = [...pending];
    pending.clear();
    options.onChange({
      botId: options.botId,
      paths,
      at: new Date().toISOString(),
    });
  };

  const schedule = (changedPath: string) => {
    pending.add(changedPath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const attach = (dir: string) => {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
        const rel = filename ? String(filename) : '';
        schedule(rel ? path.join(dir, rel) : dir);
      });
      w.on('error', () => {
        /* ignore transient watch errors */
      });
      watchers.push(w);
    } catch {
      /* watch unsupported on this path */
    }
  };

  attach(options.botSkillsDir);
  if (options.globalSkillsDir) attach(options.globalSkillsDir);

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending.clear();
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    watchers.length = 0;
  };
}

/**
 * Multi-bot skill hot-reload hub: start/stop per bot; fan-out changes.
 */
export function createSkillHotReloadHub(input: {
  resolveBotSkillsDir: (botId: string) => string;
  globalSkillsDir?: string | null;
  onChange: (change: SkillHotReloadChange) => void;
}) {
  const stops = new Map<string, () => void>();

  return {
    watchBot(botId: string) {
      const id = botId.trim();
      if (!id || stops.has(id)) return;
      const stop = watchSkillDirs({
        botId: id,
        botSkillsDir: input.resolveBotSkillsDir(id),
        globalSkillsDir: input.globalSkillsDir,
        onChange: input.onChange,
      });
      stops.set(id, stop);
    },
    unwatchBot(botId: string) {
      const stop = stops.get(botId);
      if (!stop) return;
      stop();
      stops.delete(botId);
    },
    watchAll(botIds: string[]) {
      const want = new Set(botIds.map((b) => b.trim()).filter(Boolean));
      for (const id of [...stops.keys()]) {
        if (!want.has(id)) {
          stops.get(id)?.();
          stops.delete(id);
        }
      }
      for (const id of want) this.watchBot(id);
    },
    stopAll() {
      for (const stop of stops.values()) stop();
      stops.clear();
    },
  };
}
