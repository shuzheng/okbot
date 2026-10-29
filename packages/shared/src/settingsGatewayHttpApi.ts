/** Gateway HTTP API settings schema + token/auth helpers (split from settings.ts). */

import { createId } from './text.js';

/**
 * Native always-on gateway HTTP API (`server.json` → `gatewayHttpApi`).
 * On-disk alias: legacy installs may still have `localHttpApi`; readers should accept both
 * via {@link pickGatewayHttpApiRaw} / SettingsStore normalize. Writers persist `gatewayHttpApi`.
 * Always enabled when the gateway owns the process; no UI/CLI switch to turn it off.
 * Default bind is 127.0.0.1 only. When `bindLan` is true, binds 0.0.0.0 and can serve the web UI.
 */
/** Role granted by a matching gateway HTTP credential.
 * UI copy says "user token"; mint prefix is `user_`. Internal id stays `access`
 * so existing auth gates / CLI (`access|admin`) keep working.
 */
export type GatewayAuthRole = "access" | "admin";

/** Prefix on newly minted user (access) tokens. */
export const GATEWAY_USER_TOKEN_PREFIX = "user_";
/** Prefix on newly minted admin tokens. */
export const GATEWAY_ADMIN_TOKEN_PREFIX = "admin_";

/** Per-token message / token quotas. `0` means unlimited. */
export interface GatewayApiTokenLimits {
  /** Max chat turns (messages) per local calendar day. 0 = unlimited. */
  dailyMessages: number;
  /** Max chat turns over the token lifetime. 0 = unlimited. */
  totalMessages: number;
  /** Max tokens (input+output+cache) per local calendar day. 0 = unlimited. */
  dailyTokens: number;
  /** Max tokens over the token lifetime. 0 = unlimited. */
  totalTokens: number;
}

export const EMPTY_GATEWAY_API_TOKEN_LIMITS: GatewayApiTokenLimits = {
  dailyMessages: 0,
  totalMessages: 0,
  dailyTokens: 0,
  totalTokens: 0,
};

/**
 * One gateway HTTP credential. The gateway may hold any number of these.
 * `role` matches existing privilege semantics (`access` = 用户, `admin` = 超管).
 */
export interface GatewayApiTokenEntry {
  id: string;
  name: string;
  role: GatewayAuthRole;
  /** Secret string presented as Bearer / X-OkBot-Token. */
  token: string;
  limits: GatewayApiTokenLimits;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayHttpApiSettings {
  /**
   * Always true. Kept on the wire for shape compatibility; normalize forces true
   * (legacy `false` on disk is ignored — no migration, always-on).
   */
  enabled: boolean;
  /** TCP port. Default 18765; clamp 1024–65535. */
  port: number;
  /**
   * Legacy primary access token (first `access` entry in {@link apiTokens}).
   * Kept for attach / CLI / probe compatibility; auth matches every entry in `apiTokens`.
   * Empty is allowed on disk; minted only when the owning process starts and none is saved.
   */
  token: string;
  /**
   * Legacy primary admin token (first `admin` entry in {@link apiTokens}).
   * Minted on upgrade when missing; never promoted from the old single token.
   */
  adminToken: string;
  /**
   * All gateway API tokens (user + super-admin). Prefer this list for CRUD.
   * Normalize seeds from legacy `token` / `adminToken` when empty, and mirrors
   * the first access/admin entry back into those fields.
   */
  apiTokens: GatewayApiTokenEntry[];
  /**
   * When true, bind 0.0.0.0 (LAN / desktop gateway) instead of 127.0.0.1.
   * Intranet use; auth token still required. Default false.
   */
  bindLan: boolean;
  /**
   * When true, serve the built renderer UI over HTTP for mobile browsers.
   * Normalize defaults serveUi to true when bindLan is true.
   */
  serveUi: boolean;
}

export const DEFAULT_GATEWAY_HTTP_API_PORT = 18765;

export function randomGatewayTokenSecret(): string {
  const bytes = new Uint8Array(24);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Cryptographically strong gatewayHttpApi token with role prefix:
 * access → `user_<hex>`, admin → `admin_<hex>`.
 */
export function generateGatewayHttpApiToken(role: GatewayAuthRole = "access"): string {
  const prefix = role === "admin" ? GATEWAY_ADMIN_TOKEN_PREFIX : GATEWAY_USER_TOKEN_PREFIX;
  return prefix + randomGatewayTokenSecret();
}

/** Mint a token for `role` that is not identical to `other` (access/admin must stay distinct). */
export function generateDistinctGatewayHttpApiToken(
  other: string,
  role: GatewayAuthRole = "access",
): string {
  const avoid = (other || "").trim();
  let next = generateGatewayHttpApiToken(role);
  while (avoid && next === avoid) next = generateGatewayHttpApiToken(role);
  return next;
}

/**
 * Infer role from minted prefix only. Legacy unprefixed hex returns null.
 * Never use this alone for authorization — match stored secrets via resolveGatewayAuthRole.
 */
export function gatewayTokenPrefixRole(presented: string): GatewayAuthRole | null {
  const p = (presented || "").trim();
  if (!p) return null;
  if (p.startsWith(GATEWAY_ADMIN_TOKEN_PREFIX)) return "admin";
  if (p.startsWith(GATEWAY_USER_TOKEN_PREFIX)) return "access";
  return null;
}

export const DEFAULT_GATEWAY_HTTP_API: GatewayHttpApiSettings = {
  enabled: true,
  port: DEFAULT_GATEWAY_HTTP_API_PORT,
  token: "", // filled when a server starts and none is saved
  adminToken: "", // minted on owner boot when missing
  apiTokens: [],
  bindLan: false,
  serveUi: false,
};

/** Keep only the token charset external clients can send safely. */
export function sanitizeGatewayHttpApiToken(raw: string): string {
  return (raw || "").replace(/[^A-Za-z0-9_-]/g, "");
}

/**
 * Prefer `gatewayHttpApi` on disk; fall back to legacy `localHttpApi` for one release.
 * Does not mutate the raw object. Callers normalize the returned blob.
 */
export function pickGatewayHttpApiRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if ("gatewayHttpApi" in o) return o.gatewayHttpApi;
  if ("localHttpApi" in o) return o.localHttpApi;
  return undefined;
}

function hashText(s: string): string {
  // Short stable id fragment (not cryptographic).
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const MAX_GATEWAY_API_TOKEN_NAME = 64;
const MAX_GATEWAY_API_TOKENS = 200;

function clampNonNegInt(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER);
}

export function normalizeGatewayApiTokenLimits(raw: unknown): GatewayApiTokenLimits {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    dailyMessages: clampNonNegInt(obj.dailyMessages),
    totalMessages: clampNonNegInt(obj.totalMessages),
    dailyTokens: clampNonNegInt(obj.dailyTokens),
    totalTokens: clampNonNegInt(obj.totalTokens),
  };
}

export function createGatewayApiTokenId(): string {
  return createId("gat");
}

/** Build a new token entry (secret already minted). */
export function createGatewayApiTokenEntry(input: {
  name: string;
  role: GatewayAuthRole;
  token: string;
  limits?: Partial<GatewayApiTokenLimits> | null;
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}): GatewayApiTokenEntry {
  const now = new Date().toISOString();
  const name = (input.name || "").trim().slice(0, MAX_GATEWAY_API_TOKEN_NAME) || (input.role === "admin" ? "Admin" : "User");
  return {
    id: (input.id || "").trim() || createGatewayApiTokenId(),
    name,
    role: input.role === "admin" ? "admin" : "access",
    token: sanitizeGatewayHttpApiToken(input.token),
    limits: normalizeGatewayApiTokenLimits(input.limits ?? EMPTY_GATEWAY_API_TOKEN_LIMITS),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function normalizeGatewayApiTokenEntry(raw: unknown): GatewayApiTokenEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const token = typeof o.token === "string" ? sanitizeGatewayHttpApiToken(o.token) : "";
  const role: GatewayAuthRole = o.role === "admin" ? "admin" : "access";
  const idRaw = typeof o.id === "string" && o.id.trim() ? o.id.trim().slice(0, 80) : "";
  // Empty token allowed for gateway/WebUI projected placeholders so hydrate → autosave
  // keeps the row and carryOverSecrets can refill by id (same as computers).
  // Empty-token rows must keep a stable id; inventing one would break refill.
  if (!token && !idRaw) return null;
  // Missing id + non-empty token: stable hash (not createGatewayApiTokenId) so
  // re-normalize without persist does not remint usage/quota buckets. Mint only
  // via createGatewayApiTokenEntry on explicit user add.
  const id = idRaw || `gat-seed-${hashText(`${role}\0${token}`)}`;
  const nameRaw = typeof o.name === "string" ? o.name.trim() : "";
  const name = (nameRaw || (role === "admin" ? "Admin" : "User")).slice(0, MAX_GATEWAY_API_TOKEN_NAME);
  const createdAt = typeof o.createdAt === "string" && o.createdAt.trim() ? o.createdAt.trim() : new Date().toISOString();
  const updatedAt = typeof o.updatedAt === "string" && o.updatedAt.trim() ? o.updatedAt.trim() : createdAt;
  return {
    id,
    name,
    role,
    token,
    limits: normalizeGatewayApiTokenLimits(o.limits),
    createdAt,
    updatedAt,
  };
}

/**
 * Normalize the apiTokens list. Keeps empty-token placeholders (projected secrets)
 * so carryOverSecrets can refill by id. Dedupes non-empty secrets by token string
 * (first wins); empty tokens dedupe by id only. Caps length. Does not mint secrets.
 */
export function normalizeGatewayApiTokensList(raw: unknown): GatewayApiTokenEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GatewayApiTokenEntry[] = [];
  const seenToken = new Set<string>();
  const seenId = new Set<string>();
  for (const item of raw) {
    const entry = normalizeGatewayApiTokenEntry(item);
    if (!entry) continue;
    // All empty tokens share "" — only dedupe non-empty secrets by value.
    if (entry.token && seenToken.has(entry.token)) continue;
    let id = entry.id;
    if (seenId.has(id)) {
      // Keep the first id — reminting would drift usage/quota buckets keyed by id.
      continue;
    }
    if (entry.token) seenToken.add(entry.token);
    seenId.add(id);
    out.push(id === entry.id ? entry : { ...entry, id });
    if (out.length >= MAX_GATEWAY_API_TOKENS) break;
  }
  return out;
}

/**
 * Mirror first non-empty access/admin entries into legacy `token` / `adminToken`
 * so attach, CLI, and probes keep working. Empty placeholders (attach projection)
 * are skipped so a blank row cannot wipe legacy.
 */
export function syncLegacyGatewayTokens(apiTokens: GatewayApiTokenEntry[]): {
  token: string;
  adminToken: string;
} {
  const access = apiTokens.find((e) => e.role === "access" && e.token);
  const admin = apiTokens.find((e) => e.role === "admin" && e.token);
  return {
    token: access?.token || "",
    adminToken: admin?.token || "",
  };
}

/**
 * Seed `apiTokens` from legacy dual fields when the list is empty.
 * Names: "User" / "Admin" (UI i18n labels the type separately).
 */
export function seedGatewayApiTokensFromLegacy(
  token: string,
  adminToken: string,
): GatewayApiTokenEntry[] {
  const out: GatewayApiTokenEntry[] = [];
  const now = new Date().toISOString();
  if (token) {
    out.push(
      createGatewayApiTokenEntry({
        // Stable legacy ids so re-normalize without persist does not remint quota buckets.
        id: "gat-legacy-access",
        name: "User",
        role: "access",
        token,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  if (adminToken && adminToken !== token) {
    out.push(
      createGatewayApiTokenEntry({
        id: "gat-legacy-admin",
        name: "Admin",
        role: "admin",
        token: adminToken,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  return out;
}

/**
 * Clamp / fill gateway HTTP API settings.
 * Disallowed characters are stripped (not silently replaced).
 * Does not generate a token. An empty value stays empty so a saved token is reused
 * instead of being replaced on read, on save, or when a window attaches.
 * When `apiTokens` is empty, seeds from legacy `token` / `adminToken`.
 * Mirrors the first non-empty access/admin list entry back into those fields.
 * When all same-role list tokens are empty, keeps the incoming legacy values.
 */
export function normalizeGatewayHttpApiSettings(raw: unknown): GatewayHttpApiSettings {
  const obj =
    raw && typeof raw === "object" ? (raw as Partial<Record<keyof GatewayHttpApiSettings, unknown>>) : {};
  // Always on — ignore legacy enabled:false on disk.
  const enabled = true;
  let port = typeof obj.port === "number" && Number.isFinite(obj.port) ? Math.floor(obj.port) : DEFAULT_GATEWAY_HTTP_API_PORT;
  if (port < 1024 || port > 65535) port = DEFAULT_GATEWAY_HTTP_API_PORT;
  const legacyToken = typeof obj.token === "string" ? sanitizeGatewayHttpApiToken(obj.token) : "";
  const legacyAdmin = typeof obj.adminToken === "string" ? sanitizeGatewayHttpApiToken(obj.adminToken) : "";
  let apiTokens = normalizeGatewayApiTokensList(obj.apiTokens);
  if (apiTokens.length === 0) {
    apiTokens = seedGatewayApiTokensFromLegacy(legacyToken, legacyAdmin);
  } else {
    // Keep legacy secrets that are not yet in the list (partial upgrades / hand edits).
    const have = new Set(apiTokens.map((e) => e.token));
    if (legacyToken && !have.has(legacyToken)) {
      apiTokens = [
        createGatewayApiTokenEntry({
          id: "gat-legacy-access",
          name: "User",
          role: "access",
          token: legacyToken,
        }),
        ...apiTokens,
      ];
      have.add(legacyToken);
    }
    if (legacyAdmin && legacyAdmin !== legacyToken && !have.has(legacyAdmin)) {
      apiTokens = [
        createGatewayApiTokenEntry({
          id: "gat-legacy-admin",
          name: "Admin",
          role: "admin",
          token: legacyAdmin,
        }),
        ...apiTokens,
      ];
    }
    if (apiTokens.length > MAX_GATEWAY_API_TOKENS) {
      apiTokens = apiTokens.slice(0, MAX_GATEWAY_API_TOKENS);
    }
  }
  const synced = syncLegacyGatewayTokens(apiTokens);
  // When every same-role apiTokens entry is blank (attach/WebUI projection), keep
  // the incoming legacy dual fields — do not overwrite with "".
  const token = synced.token || legacyToken;
  const adminToken = synced.adminToken || legacyAdmin;
  const bindLan = obj.bindLan === true;
  // serveUi defaults to true when bindLan (gateway hosts UI); otherwise false
  const serveUi = obj.serveUi === true || (obj.serveUi !== false && bindLan);
  return {
    enabled,
    port,
    token,
    adminToken,
    apiTokens,
    bindLan,
    serveUi,
  };
}

/** Result of matching a presented credential against gateway settings. */
export type GatewayAuthMatch = {
  role: GatewayAuthRole;
  /** Entry id when matched via `apiTokens`; null for pure legacy dual-field match. */
  tokenId: string | null;
  entry: GatewayApiTokenEntry | null;
};

/**
 * Match a presented credential against every `apiTokens` entry, then legacy
 * `adminToken` / `token`. Admin entries win when the same secret appears twice
 * (should not happen after normalize). Prefix alone never grants a role.
 */
export function resolveGatewayAuth(
  presented: string,
  api: Pick<GatewayHttpApiSettings, "token" | "adminToken" | "apiTokens">,
): GatewayAuthMatch | null {
  const p = (presented || "").trim();
  if (!p) return null;
  const list = Array.isArray(api.apiTokens) ? api.apiTokens : [];
  let accessHit: GatewayAuthMatch | null = null;
  for (const entry of list) {
    if (!entry?.token || entry.token !== p) continue;
    const match: GatewayAuthMatch = {
      role: entry.role === "admin" ? "admin" : "access",
      tokenId: entry.id,
      entry,
    };
    if (match.role === "admin") return match;
    if (!accessHit) accessHit = match;
  }
  if (accessHit) return accessHit;
  if (api.adminToken && p === api.adminToken) {
    return { role: "admin", tokenId: null, entry: null };
  }
  if (api.token && p === api.token) {
    return { role: "access", tokenId: null, entry: null };
  }
  return null;
}

/**
 * Match a presented credential to access or admin by exact equality with stored secrets.
 * Prefer {@link resolveGatewayAuth} when `apiTokens` is available.
 * Admin is checked first so a string that equals both (should not happen) grants admin.
 * Prefix alone never grants a role.
 */
export function resolveGatewayAuthRole(
  presented: string,
  accessToken: string,
  adminToken: string,
  apiTokens?: GatewayApiTokenEntry[],
): GatewayAuthRole | null {
  if (apiTokens && apiTokens.length > 0) {
    return resolveGatewayAuth(presented, {
      token: accessToken,
      adminToken,
      apiTokens,
    })?.role ?? null;
  }
  const p = (presented || "").trim();
  if (!p) return null;
  if (adminToken && p === adminToken) return "admin";
  if (accessToken && p === accessToken) return "access";
  return null;
}

/** Sum input+output+cache for quota checks. */
export function totalTokensUsed(usage: { input?: number; output?: number; cache?: number } | null | undefined): number {
  if (!usage) return 0;
  return (usage.input || 0) + (usage.output || 0) + (usage.cache || 0);
}

export type GatewayApiTokenQuotaReason =
  | "daily_messages"
  | "total_messages"
  | "daily_tokens"
  | "total_tokens";

/**
 * Whether a token may start another chat turn given current usage counters.
 * Limits of `0` are unlimited. `pendingMessages` / `pendingTokens` are added to
 * current usage before comparing (usually 1 message / 0 tokens at gate time).
 */
export function checkGatewayApiTokenQuota(input: {
  limits: GatewayApiTokenLimits;
  lifetimeMessages: number;
  lifetimeTokens: number;
  dailyMessages: number;
  dailyTokens: number;
  pendingMessages?: number;
  pendingTokens?: number;
}): { ok: true } | { ok: false; reason: GatewayApiTokenQuotaReason } {
  const limits = normalizeGatewayApiTokenLimits(input.limits);
  const pendingMessages = Math.max(0, input.pendingMessages ?? 0);
  const pendingTokens = Math.max(0, input.pendingTokens ?? 0);
  const lifeMsg = Math.max(0, input.lifetimeMessages) + pendingMessages;
  const dayMsg = Math.max(0, input.dailyMessages) + pendingMessages;
  const lifeTok = Math.max(0, input.lifetimeTokens) + pendingTokens;
  const dayTok = Math.max(0, input.dailyTokens) + pendingTokens;
  if (limits.dailyMessages > 0 && dayMsg > limits.dailyMessages) {
    return { ok: false, reason: "daily_messages" };
  }
  if (limits.totalMessages > 0 && lifeMsg > limits.totalMessages) {
    return { ok: false, reason: "total_messages" };
  }
  if (limits.dailyTokens > 0 && dayTok > limits.dailyTokens) {
    return { ok: false, reason: "daily_tokens" };
  }
  if (limits.totalTokens > 0 && lifeTok > limits.totalTokens) {
    return { ok: false, reason: "total_tokens" };
  }
  return { ok: true };
}

