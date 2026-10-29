/**
 * Keep previous roster object identities when fields are unchanged.
 * Avatar auto-save / sessions_changed otherwise replaces every Bot/Squad
 * reference and forces chat markdown (and memo'd rows) to re-render.
 */

function shallowEqualRecord(a: object, b: object): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a) as (keyof typeof a)[];
  const bKeys = Object.keys(b) as (keyof typeof b)[];
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    const av = (a as Record<string, unknown>)[key as string];
    const bv = (b as Record<string, unknown>)[key as string];
    if (av === bv) continue;
    // members[] / enabledGlobalSkills[] — compare by JSON for stable roster rows
    if (Array.isArray(av) || Array.isArray(bv)) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
      continue;
    }
    if (av && bv && typeof av === 'object' && typeof bv === 'object') {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
      continue;
    }
    return false;
  }
  return true;
}

export function reconcileById<T extends { id: string }>(
  prev: readonly T[],
  next: readonly T[],
): T[] {
  if (prev === next) return prev as T[];
  if (!next.length) return prev.length ? [] : (prev as T[]);
  if (!prev.length) return [...next];

  const prevById = new Map(prev.map((p) => [p.id, p]));
  let changed = prev.length !== next.length;
  const out: T[] = new Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const n = next[i]!;
    const p = prevById.get(n.id);
    if (p && shallowEqualRecord(p, n)) {
      out[i] = p;
      if (p !== prev[i]) changed = true;
    } else {
      out[i] = n;
      changed = true;
    }
  }
  if (!changed) {
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== out[i]) {
        changed = true;
        break;
      }
    }
  }
  return changed ? out : (prev as T[]);
}
