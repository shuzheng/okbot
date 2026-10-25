import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read `@okbot/gateway` version from its package.json (do not invent a number). */
export function readGatewayVersion(fromDir = path.dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [
    path.join(fromDir, '..', '..', 'package.json'), // src/cli → apps/gateway
    path.join(fromDir, '..', 'package.json'), // dist layout fallback
    path.join(fromDir, '..', '..', '..', 'package.json'),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown };
      const name = typeof raw.name === 'string' ? raw.name : '';
      const version = typeof raw.version === 'string' ? raw.version.trim() : '';
      if (!version) continue;
      if (name === '@okbot/gateway') return version;
      // Prefer gateway package path even if name missing
      if (path.basename(path.dirname(file)) === 'gateway') return version;
    } catch {
      /* try next */
    }
  }
  return '';
}
