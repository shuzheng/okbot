import { LOCAL_COMPUTER_ID } from '@okbot/shared';

/** Remote computer the router can execute on. Local is implicit and not listed. */
export type RoutedComputer = {
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
  /** Omitted or true = available. False keeps the registration but skips routing. */
  enabled?: boolean;
};

/**
 * One selection policy for shell/fs tools.
 * Default computer (settings, else local) when nothing is named.
 * A single named computer in the user text overrides that.
 * Several named computers require each tool call to pass `computer`.
 * An explicit tool arg (id or name) always wins when it matches.
 */
export type ComputerRoute = {
  /** Settings default. Missing means local. Unknown or disabled does not fall back to local. */
  defaultComputerId?: string | null;
  /** Optional per-request override (HTTP API computerId), below a named computer. */
  turnComputerId?: string | null;
  computers?: RoutedComputer[];
  /** Current user message, or a member task appended to it. */
  userText?: string | null;
};

export type ComputerChoice = { id: string; name: string };

const LOCAL_NAME = '本机';

export function computerCatalog(route: ComputerRoute): ComputerChoice[] {
  const remotes: ComputerChoice[] = [];
  const seen = new Set<string>();
  for (const c of route.computers ?? []) {
    if (c?.enabled === false) continue;
    const id = (c?.id || '').trim();
    if (!id || id === LOCAL_COMPUTER_ID || seen.has(id)) continue;
    seen.add(id);
    const name = (c.name || '').trim() || id;
    remotes.push({ id, name });
  }
  return [{ id: LOCAL_COMPUTER_ID, name: LOCAL_NAME }, ...remotes];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function spanHits(
  text: string,
  label: string,
  mode: 'id' | 'name',
): Array<{ index: number; length: number }> {
  if (!label) return [];
  const hits: Array<{ index: number; length: number }> = [];
  if (/^[\x00-\x7F]+$/.test(label)) {
    // Names treat "-" as a separator so "Mac mini-MacBook Air" matches both.
    // Ids keep "-" inside the token so one id is not a prefix of another.
    const edge = mode === 'name' ? 'A-Za-z0-9_' : 'A-Za-z0-9_-';
    const re = new RegExp(
      `(?:^|[^${edge}])(${escapeRegExp(label)})(?=$|[^${edge}])`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const token = m[1] || '';
      const index = m.index + m[0].length - token.length;
      hits.push({ index, length: token.length });
      if (m[0].length === 0) re.lastIndex += 1;
    }
    return hits;
  }
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(label, from);
    if (index < 0) break;
    hits.push({ index, length: label.length });
    from = index + Math.max(1, label.length);
  }
  return hits;
}

/** Computers named in text (id, name, or 本机). Longer names win over inner ones.
 *  The id `local` is not a text mention — paths like /usr/local/bin must not select this machine.
 *  Pass `local` only as an explicit computer argument.
 */
export function computersMentioned(text: string, route: ComputerRoute): ComputerChoice[] {
  const raw = text || '';
  if (!raw.trim()) return [];
  const list = computerCatalog(route);
  type Hit = ComputerChoice & { index: number; length: number };
  const hits: Hit[] = [];
  for (const c of list) {
    const labels =
      c.id === LOCAL_COMPUTER_ID
        ? [{ label: LOCAL_NAME, mode: 'name' as const }]
        : [
            { label: c.id, mode: 'id' as const },
            { label: c.name, mode: 'name' as const },
          ];
    const seenLabel = new Set<string>();
    for (const item of labels) {
      const trimmed = (item.label || '').trim();
      if (trimmed.length < 2) continue;
      const key = trimmed.toLowerCase();
      if (seenLabel.has(key)) continue;
      seenLabel.add(key);
      for (const span of spanHits(raw, trimmed, item.mode)) {
        hits.push({ ...c, ...span });
      }
    }
  }
  const kept = hits.filter(
    (h) =>
      !hits.some(
        (o) =>
          o !== h &&
          o.index <= h.index &&
          o.index + o.length >= h.index + h.length &&
          o.length > h.length,
      ),
  );
  const byId = new Map<string, ComputerChoice>();
  for (const h of kept) byId.set(h.id, { id: h.id, name: h.name });
  return [...byId.values()];
}

export function formatComputerChoices(list: ComputerChoice[]): string {
  return list.map((c) => `${c.name}（id=${c.id}）`).join('、');
}

/** Settings default if it still exists. Unknown or disabled ids are empty, not local. */
export function settingsDefaultComputerId(route: ComputerRoute): string {
  const list = computerCatalog(route);
  const id = (route.defaultComputerId || '').trim();
  if (!id || id === LOCAL_COMPUTER_ID) return LOCAL_COMPUTER_ID;
  if (list.some((c) => c.id === id)) return id;
  return '';
}

/**
 * Why this turn must not run on local.
 * Empty default means local. A set id that is missing or disabled is a hard stop.
 * An unknown turnComputerId does not fall through to the settings default.
 */
export function configuredComputerProblem(route: ComputerRoute): string | null {
  const list = computerCatalog(route);
  const known = (id: string) => id === LOCAL_COMPUTER_ID || list.some((c) => c.id === id);
  const turn = (route.turnComputerId || '').trim();
  if (turn) {
    if (known(turn)) return null;
    return `指定电脑「${turn}」不存在或已禁用，不会改在本机执行。`;
  }
  const id = (route.defaultComputerId || '').trim();
  if (!id || known(id)) return null;
  return `默认电脑「${id}」不存在或已禁用，不会改在本机执行。`;
}

/** Computer used when this turn names none. Empty string means the configured id is unusable. */
export function effectiveDefaultComputerId(route: ComputerRoute): string {
  const list = computerCatalog(route);
  const turn = (route.turnComputerId || '').trim();
  if (turn === LOCAL_COMPUTER_ID) return LOCAL_COMPUTER_ID;
  if (turn && list.some((c) => c.id === turn)) return turn;
  if (turn) return '';
  return settingsDefaultComputerId(route);
}

export function defaultComputerLabel(route: ComputerRoute): string {
  const id = effectiveDefaultComputerId(route);
  if (!id) return '不可用';
  return computerCatalog(route).find((c) => c.id === id)?.name || LOCAL_NAME;
}

export type ImplicitComputer =
  | { kind: 'one'; id: string }
  | { kind: 'ambiguous'; labels: string[] }
  | { kind: 'invalid'; message: string };

export function resolveImplicitComputer(route: ComputerRoute): ImplicitComputer {
  const mentioned = computersMentioned(route.userText || '', route);
  if (mentioned.length > 1) {
    return { kind: 'ambiguous', labels: mentioned.map((c) => `${c.name}（${c.id}）`) };
  }
  if (mentioned.length === 1) return { kind: 'one', id: mentioned[0]!.id };
  const id = effectiveDefaultComputerId(route);
  if (!id) {
    return {
      kind: 'invalid',
      message: configuredComputerProblem(route) || '默认电脑不可用，不会改在本机执行。',
    };
  }
  return { kind: 'one', id };
}

function matchRequested(
  requested: string,
  route: ComputerRoute,
): { ok: true; id: string } | { ok: false; message: string } {
  const q = requested.trim();
  const list = computerCatalog(route);
  if (q === LOCAL_NAME || q.toLowerCase() === LOCAL_COMPUTER_ID) {
    return { ok: true, id: LOCAL_COMPUTER_ID };
  }
  const byId = list.filter((c) => c.id.toLowerCase() === q.toLowerCase());
  if (byId.length === 1) return { ok: true, id: byId[0]!.id };
  const byName = list.filter((c) => c.name.toLowerCase() === q.toLowerCase());
  if (byName.length === 1) return { ok: true, id: byName[0]!.id };
  if (byName.length > 1) {
    return {
      ok: false,
      message: `电脑名称「${q}」对应多台，请改用 id。可选：${formatComputerChoices(list)}`,
    };
  }
  return {
    ok: false,
    message: `没有名为「${q}」的电脑。可选：${formatComputerChoices(list)}`,
  };
}

/** Resolve the computer for one shell/fs tool call. */
export function selectComputerForTool(
  route: ComputerRoute,
  requested?: string | null,
): { ok: true; id: string } | { ok: false; message: string } {
  const req = (requested || '').trim();
  if (req) return matchRequested(req, route);
  const implicit = resolveImplicitComputer(route);
  if (implicit.kind === 'ambiguous') {
    return {
      ok: false,
      message: `这轮对话点了多台电脑（${implicit.labels.join('、')}）。请在 computer 参数里指定其中一台。`,
    };
  }
  if (implicit.kind === 'invalid') return { ok: false, message: implicit.message };
  return { ok: true, id: implicit.id };
}

/** System-prompt section. Same policy as selectComputerForTool. */
type ShellFsPrefs = {
  run_shell?: { enabled?: boolean };
  read_file?: { enabled?: boolean };
  write_file?: { enabled?: boolean };
  edit_file?: { enabled?: boolean };
};

export function formatComputerRoutingSection(route: ComputerRoute): string {
  const list = computerCatalog(route);
  const problem = configuredComputerProblem(route);
  if (problem) {
    return [
      '## 执行电脑',
      `可用电脑：${formatComputerChoices(list)}。`,
      problem,
      '在该问题解决前，不要调用 run_shell / read_file / write_file / edit_file。',
    ].join('\n');
  }
  const id = effectiveDefaultComputerId(route);
  const current = list.find((c) => c.id === id) || list[0]!;
  return [
    '## 执行电脑',
    `可用电脑：${formatComputerChoices(list)}。`,
    `默认电脑：${current.name}（id=${current.id}）。用户没有点名电脑时，run_shell / read_file / write_file / edit_file 在默认电脑上执行。`,
    '用户点名恰好一台时，可以省略 computer，也会在那台执行。',
    '用户要求在多台电脑上执行时，每次调用上述工具都必须传 computer（填 id 或名称），分别在对应电脑上执行。',
    'read_skill 与 generate_image 始终在运行 OkBot 的桌面主机上，不随电脑切换。',
  ].join('\n');
}

/** Omit the routing section when no shell/fs tool is enabled. */
export function shellFsRoutingSection(
  route: ComputerRoute | undefined,
  prefs?: ShellFsPrefs | null,
): string {
  if (!route) return '';
  const on = Boolean(
    prefs?.run_shell?.enabled ||
      prefs?.read_file?.enabled ||
      prefs?.write_file?.enabled ||
      prefs?.edit_file?.enabled,
  );
  if (!on) return '';
  return formatComputerRoutingSection(route);
}
