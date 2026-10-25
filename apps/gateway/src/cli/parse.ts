/** Lightweight argv parsing for the okbot multi-command CLI. */

export type ParsedArgv = {
  /** Primary command (serve, status, …) or null when only global flags. */
  command: string | null;
  /** Remaining args after command (subcommand + flags). */
  args: string[];
  /** Global --lang if present. */
  lang: string | null;
  /** Global or command --help / -h. */
  help: boolean;
  /** Global --version / -V (also command "version"). */
  version: boolean;
  /** Parse error message key or raw text; caller maps to i18n. */
  error: 'invalid_lang' | null;
};

const COMMANDS = new Set([
  'help',
  'version',
  'serve',
  'status',
  'stop',
  'restart',
  'config',
  'token',
  'data',
]);

export function isKnownCommand(name: string): boolean {
  return COMMANDS.has(name);
}

/**
 * Parse `process.argv.slice(2)` style tokens.
 * `--lang` may appear before or after the command.
 */
export function parseArgv(argv: string[]): ParsedArgv {
  const tokens = [...argv];
  let lang: string | null = null;
  let help = false;
  let version = false;
  let error: ParsedArgv['error'] = null;
  const positional: string[] = [];
  const passthrough: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === '--lang') {
      const v = tokens[++i];
      if (v !== 'zh' && v !== 'en') {
        error = 'invalid_lang';
        lang = v ?? null;
      } else {
        lang = v;
      }
      continue;
    }
    if (t.startsWith('--lang=')) {
      const v = t.slice('--lang='.length);
      if (v !== 'zh' && v !== 'en') {
        error = 'invalid_lang';
        lang = v || null;
      } else {
        lang = v;
      }
      continue;
    }
    if (t === '--help' || t === '-h') {
      help = true;
      continue;
    }
    if (t === '--version' || t === '-V') {
      version = true;
      continue;
    }
    // Once we have a command, keep remaining flags for the command
    // (except we already stripped global --lang/--help/--version above when we see them).
    positional.push(t);
  }

  // Re-scan: global flags already stripped; first non-flag is command,
  // rest go to args. Command-local --help may still be in positional if
  // we want command help — we already consumed all --help as global help.
  // That is intentional: `okbot serve --help` → help=true, command=serve.
  let command: string | null = null;
  for (let i = 0; i < positional.length; i++) {
    const t = positional[i]!;
    if (command === null) {
      command = t;
      continue;
    }
    passthrough.push(t);
  }

  if (version && !command) {
    return { command: null, args: passthrough, lang, help, version: true, error };
  }

  return { command, args: passthrough, lang, help, version, error };
}

/** Parse true/false from CLI flag values. */
export function parseBool(raw: string | undefined): boolean | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return null;
}

/** Validate gateway listen port (same clamp range as normalizeGatewayHttpApiSettings). */
export function parsePort(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return null;
  return n;
}

export function maskToken(token: string): string {
  const t = token || '';
  if (!t) return '(empty)';
  if (t.length <= 4) return '****';
  return `****${t.slice(-4)}`;
}
