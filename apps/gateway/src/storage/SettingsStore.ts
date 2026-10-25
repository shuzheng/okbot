import fs from 'node:fs';
import {
  DEFAULT_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  type AppSettings,
  type ClientSettings,
  normalizeToolPreferences,
  normalizeModelSettings,
  normalizeContextCompression,
  normalizeSecuritySettings,
  normalizeSquadSettings,
  normalizeInstructionsSettings,
  LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT,
  LEGACY_AGENTS_MD_REFRESH_SECTION_PATCH,
  LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD,
  LEGACY_AGENTS_MD_REFRESH_FULL_FILE,
  LEGACY_AGENTS_MD_REFRESH_WITH_ROBOT,
  LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA,
  LEGACY_DEFAULT_SQUAD_PLAYBOOK,
  normalizeMemorySettings,
  normalizeMaintenanceSettings,
  normalizeMeshSettings,
  normalizeGatewayHttpApiSettings, pickGatewayHttpApiRaw,
  normalizeComputers,
  normalizeMcpSettings,
  normalizeWebSettings,
  normalizeAssistantMarketplaceSettings,
  normalizeDefaultComputerId,
  normalizeDefaultAssistantId,
  normalizeTimezone,
  normalizePinnedOwnerIds,
  normalizeHiddenOwnerIds,
  normalizeOwnerGroups,
  normalizeOwnerGroupMembership,
  normalizeOwnerGroupOrder,
  peelClientSettingsFromRaw,
  stripClientSettingsKeys,
  mergeClientGatewaySettings,
} from '@okbot/shared';
import { readJson, readJsonResult, backupFileAside, writeJson } from './fs';
import { normalizeAutoApprovalRules } from './ids';

/**
 * Gateway `~/.okbot/server.json` (legacy: `settings.json`).
 * Client chrome (theme, language, window, …) is not persisted here — see
 * Electron `~/.okbot/client.json` / Web localStorage. Legacy combined files
 * are peeled once on read; {@link takePeeledClientSettings} hands chrome to the desktop.
 */
export class SettingsStore {
  settingsLoadWarning: string | null = null;
  private settingsCorruptHandled = false;
  /** Client chrome peeled from a legacy combined settings.json (once). */
  private peeledClientSettings: ClientSettings | null = null;
  private clientKeysStripped = false;

  constructor(
    /** Durable data root (`~/.okbot/data`) — chmod 0700. */
    private readonly root: string,
    /** Absolute path to gateway settings (`~/.okbot/server.json`). */
    private readonly settingsPath: string,
  ) {}

  restrictDataDir(): void {
    try {
      fs.chmodSync(this.root, 0o700);
    } catch (err) {
      console.error('[okbot] chmod data dir failed', err);
    }
  }

  restrictSettingsFile(): void {
    try {
      if (!fs.existsSync(this.settingsPath)) return;
      fs.chmodSync(this.settingsPath, 0o600);
    } catch (err) {
      console.error('[okbot] chmod server.json failed', err);
    }
  }

  writeSettingsFile(data: unknown): void {
    writeJson(this.settingsPath, data, { mode: 0o600 });
    this.restrictSettingsFile();
  }


  /** Consume a settings-load warning once (for bootstrap toast). */
  takeSettingsLoadWarning(): string | null {
    const w = this.settingsLoadWarning;
    this.settingsLoadWarning = null;
    return w;
  }

  /**
   * Client chrome peeled from a legacy combined `settings.json` on first successful read.
   * Electron copies this into `~/.okbot/client.json` when that file is missing/incomplete.
   */
  takePeeledClientSettings(): ClientSettings | null {
    const c = this.peeledClientSettings;
    this.peeledClientSettings = null;
    return c;
  }

  getSettings(): AppSettings {
    const loaded = readJsonResult<AppSettings>(this.settingsPath, DEFAULT_SETTINGS);
    // Parse/IO failure: keep the broken file, backup a copy, return in-memory defaults.
    // Never migrate-write here — that used to wipe API keys when the settings file went bad.
    if (loaded.status === 'invalid') {
      if (!this.settingsCorruptHandled) {
        this.settingsCorruptHandled = true;
        const backup = backupFileAside(this.settingsPath, 'corrupt');
        const detail = backup
          ? `server.json 无法解析（${loaded.error}）。已备份到 ${backup}，未覆盖原文件；请修复后重启，或在设置里重新填写 API Key。`
          : `server.json 无法解析（${loaded.error}）。未能写入备份；未覆盖原文件。请检查数据目录后重启，或在设置里重新填写 API Key。`;
        console.error('[okbot]', detail);
        this.settingsLoadWarning = detail;
      }
      return {
        ...DEFAULT_SETTINGS,
        model: {
          ...DEFAULT_SETTINGS.model,
          providers: DEFAULT_SETTINGS.model.providers.map((p) => ({
            ...p,
            models: [...p.models],
          })),
        },
        tools: {
          run_shell: { ...DEFAULT_SETTINGS.tools.run_shell },
          read_file: { ...DEFAULT_SETTINGS.tools.read_file },
          read_skill: { ...DEFAULT_SETTINGS.tools.read_skill },
          write_file: { ...DEFAULT_SETTINGS.tools.write_file },
          edit_file: { ...DEFAULT_SETTINGS.tools.edit_file },
          generate_image: { ...DEFAULT_SETTINGS.tools.generate_image },
          search_history: { ...DEFAULT_SETTINGS.tools.search_history },
          manage_schedule: { ...DEFAULT_SETTINGS.tools.manage_schedule },
          manage_task_progress: { ...DEFAULT_SETTINGS.tools.manage_task_progress },
          send_message: { ...DEFAULT_SETTINGS.tools.send_message },
          web_fetch: { ...DEFAULT_SETTINGS.tools.web_fetch },
          web_search: { ...DEFAULT_SETTINGS.tools.web_search },
        },
        security: {
          ...DEFAULT_SETTINGS.security,
          deniedPathPrefixes: [...DEFAULT_SETTINGS.security.deniedPathPrefixes],
          allowedPathPrefixes: [...DEFAULT_SETTINGS.security.allowedPathPrefixes],
        },
        contextCompression: { ...DEFAULT_SETTINGS.contextCompression },
        instructions: { ...DEFAULT_SETTINGS.instructions },
        memory: { ...DEFAULT_SETTINGS.memory },
        maintenance: { ...DEFAULT_SETTINGS.maintenance },
        squad: { ...DEFAULT_SETTINGS.squad },
        mesh: { ...DEFAULT_SETTINGS.mesh },
        gatewayHttpApi: normalizeGatewayHttpApiSettings(DEFAULT_SETTINGS.gatewayHttpApi),
        computers: [],
        defaultComputerId: 'local',
        autoApprovalRules: [...DEFAULT_SETTINGS.autoApprovalRules],
        mcp: normalizeMcpSettings(DEFAULT_SETTINGS.mcp),
        web: normalizeWebSettings(DEFAULT_SETTINGS.web),
        assistantMarketplace: normalizeAssistantMarketplaceSettings(
          DEFAULT_SETTINGS.assistantMarketplace,
        ),
      };
    }

    const raw = loaded.data;
    // Peel legacy client chrome out of combined settings.json (once per process).
    const peeled = peelClientSettingsFromRaw(raw);
    if (peeled.hadClientKeys && !this.peeledClientSettings) {
      this.peeledClientSettings = peeled.client;
    }

    // Gateway half only — client chrome placeholders are DEFAULT_CLIENT_SETTINGS.
    // Electron / Web overlay the real client store on top for UI.
    const next: AppSettings = mergeClientGatewaySettings(
      {
        ...DEFAULT_SETTINGS,
        timezone: normalizeTimezone((raw as { timezone?: unknown }).timezone),
        autoApprovalEnabled: raw.autoApprovalEnabled === true,
        autoApprovalRules: normalizeAutoApprovalRules(raw.autoApprovalRules),
        tools: normalizeToolPreferences((raw as { tools?: unknown }).tools),
        security: normalizeSecuritySettings((raw as { security?: unknown }).security),
        model: normalizeModelSettings(raw.model),
        contextCompression: normalizeContextCompression(
          (raw as { contextCompression?: unknown }).contextCompression,
        ),
        instructions: normalizeInstructionsSettings((raw as { instructions?: unknown }).instructions),
        memory: normalizeMemorySettings((raw as { memory?: unknown }).memory),
        maintenance: normalizeMaintenanceSettings((raw as { maintenance?: unknown }).maintenance),
        squad: normalizeSquadSettings((raw as { squad?: unknown }).squad),
        mesh: normalizeMeshSettings((raw as { mesh?: unknown }).mesh),
        gatewayHttpApi: normalizeGatewayHttpApiSettings(pickGatewayHttpApiRaw(raw)),
        computers: normalizeComputers((raw as { computers?: unknown }).computers),
        defaultComputerId: normalizeDefaultComputerId(
          (raw as { defaultComputerId?: unknown }).defaultComputerId,
          normalizeComputers((raw as { computers?: unknown }).computers),
        ),
        // Bot list lives in RosterStore; validate / clear on delete + UI save.
        defaultAssistantId: normalizeDefaultAssistantId(
          (raw as { defaultAssistantId?: unknown }).defaultAssistantId,
        ),
        pinnedOwnerIds: normalizePinnedOwnerIds(
          (raw as { pinnedOwnerIds?: unknown }).pinnedOwnerIds,
        ),
        hiddenOwnerIds: normalizeHiddenOwnerIds(
          (raw as { hiddenOwnerIds?: unknown }).hiddenOwnerIds,
        ),
        ownerGroups: normalizeOwnerGroups(
          (raw as { ownerGroups?: unknown }).ownerGroups,
        ),
        ownerGroupOrder: normalizeOwnerGroupOrder(
          (raw as { ownerGroupOrder?: unknown }).ownerGroupOrder,
          normalizeOwnerGroups((raw as { ownerGroups?: unknown }).ownerGroups),
        ),
        ownerGroupMembership: normalizeOwnerGroupMembership(
          (raw as { ownerGroupMembership?: unknown }).ownerGroupMembership,
          normalizeOwnerGroups((raw as { ownerGroups?: unknown }).ownerGroups),
        ),
        mcp: normalizeMcpSettings((raw as { mcp?: unknown }).mcp),
        web: normalizeWebSettings((raw as { web?: unknown }).web),
        assistantMarketplace: normalizeAssistantMarketplaceSettings(
          (raw as { assistantMarketplace?: unknown }).assistantMarketplace,
        ),
      } as AppSettings,
      DEFAULT_CLIENT_SETTINGS,
    );
    // Rewrite legacy shapes in place (no dual-read forever). Only when we actually
    // read a file from disk — never after parse failure.
    if (loaded.status === 'ok') {
      const rawModel = (raw as unknown as { model?: Record<string, unknown> }).model;
      // Flat single-provider (no `providers`) or older `{ model, contextWindow }`.
      const legacyModel =
        rawModel &&
        typeof rawModel === 'object' &&
        !Array.isArray(rawModel.providers);
      const legacySquadMissing = (raw as { squad?: unknown }).squad === undefined;
      const rawSquad = (raw as { squad?: { captainPersona?: unknown; playbook?: unknown } }).squad;
      const rawPersona =
        rawSquad && typeof rawSquad.captainPersona === 'string'
          ? rawSquad.captainPersona.trim()
          : '';
      const rawPlaybook =
        rawSquad && typeof rawSquad.playbook === 'string' ? rawSquad.playbook.trim() : '';
      const legacySquadSerial =
        rawPersona === LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA ||
        rawPlaybook === LEGACY_DEFAULT_SQUAD_PLAYBOOK;
      const rawLocal = pickGatewayHttpApiRaw(raw);
      // Missing shape only. An empty token is kept; server start fills it once.
      // Treating "" as legacy rewrote a new token on every read, including attach.
      const rawHasLegacyLocalHttpApiDiskKey =
        raw &&
        typeof raw === 'object' &&
        !Array.isArray(raw) &&
        'localHttpApi' in (raw as object) &&
        !('gatewayHttpApi' in (raw as object));
      const legacyGatewayHttpApi =
        rawHasLegacyLocalHttpApiDiskKey ||
        rawLocal === undefined ||
        typeof rawLocal !== 'object' ||
        rawLocal === null ||
        typeof (rawLocal as { token?: unknown }).token !== 'string';
      const rawInstructions = (raw as {
        instructions?: {
          soulMdRefreshSystemPrompt?: unknown;
          agentsMdRefreshSystemPrompt?: unknown;
        };
      }).instructions;
      const rawSoulPromptSrc =
        rawInstructions && typeof rawInstructions.soulMdRefreshSystemPrompt === 'string'
          ? rawInstructions.soulMdRefreshSystemPrompt
          : rawInstructions && typeof rawInstructions.agentsMdRefreshSystemPrompt === 'string'
            ? rawInstructions.agentsMdRefreshSystemPrompt
            : '';
      const rawAgentsPrompt = typeof rawSoulPromptSrc === 'string' ? rawSoulPromptSrc.trim() : '';
      const legacyKey =
        !!rawInstructions &&
        typeof rawInstructions.agentsMdRefreshSystemPrompt === 'string' &&
        typeof rawInstructions.soulMdRefreshSystemPrompt !== 'string';
      const legacyAgentsRefreshPrompt =
        legacyKey ||
        rawAgentsPrompt === LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT ||
        rawAgentsPrompt === LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD ||
        rawAgentsPrompt === LEGACY_AGENTS_MD_REFRESH_FULL_FILE ||
        rawAgentsPrompt === LEGACY_AGENTS_MD_REFRESH_WITH_ROBOT ||
        rawAgentsPrompt === LEGACY_AGENTS_MD_REFRESH_SECTION_PATCH;
      const stripClientChrome = peeled.hadClientKeys && !this.clientKeysStripped;
      if (
        legacyModel ||
        legacySquadMissing ||
        legacySquadSerial ||
        legacyGatewayHttpApi ||
        legacyAgentsRefreshPrompt ||
        stripClientChrome
      ) {
        backupFileAside(this.settingsPath, 'pre-migrate');
        this.writeSettingsFile(stripClientSettingsKeys(next as unknown as Record<string, unknown>));
        if (stripClientChrome) this.clientKeysStripped = true;
      }
    }
    return next;
  }


  saveSettings(settings: AppSettings): AppSettings {
    // Persist gateway fields only. Client chrome is ignored here (Electron / Web
    // write it to ~/.okbot/client.json or localStorage). Returned object still has the
    // AppSettings shape with DEFAULT_CLIENT_SETTINGS placeholders.
    const gatewayCore = {
      timezone: normalizeTimezone(settings.timezone),
      autoApprovalEnabled: settings.autoApprovalEnabled === true,
      autoApprovalRules: normalizeAutoApprovalRules(settings.autoApprovalRules),
      tools: normalizeToolPreferences(settings.tools),
      security: normalizeSecuritySettings(settings.security),
      model: (() => {
        const m = normalizeModelSettings(settings.model);
        return {
          providers: m.providers.map((p) => ({
            ...p,
            baseURL: p.baseURL.trim(),
            apiKey: p.apiKey,
            name: p.name.trim() || p.name,
            models: [...p.models],
          })),
          defaultProviderId: m.defaultProviderId,
          defaultModelId: m.defaultModelId,
        };
      })(),
      contextCompression: normalizeContextCompression(settings.contextCompression),
      instructions: normalizeInstructionsSettings(settings.instructions),
      memory: normalizeMemorySettings(settings.memory),
      maintenance: normalizeMaintenanceSettings(settings.maintenance),
      squad: normalizeSquadSettings(settings.squad),
      mesh: normalizeMeshSettings(settings.mesh),
      gatewayHttpApi: normalizeGatewayHttpApiSettings(settings.gatewayHttpApi),
      computers: normalizeComputers(settings.computers),
      defaultComputerId: normalizeDefaultComputerId(
        settings.defaultComputerId,
        normalizeComputers(settings.computers),
      ),
      defaultAssistantId: normalizeDefaultAssistantId(settings.defaultAssistantId),
      pinnedOwnerIds: normalizePinnedOwnerIds(settings.pinnedOwnerIds),
      hiddenOwnerIds: normalizeHiddenOwnerIds(settings.hiddenOwnerIds),
      ownerGroups: normalizeOwnerGroups(settings.ownerGroups),
      ownerGroupOrder: normalizeOwnerGroupOrder(
        settings.ownerGroupOrder,
        normalizeOwnerGroups(settings.ownerGroups),
      ),
      ownerGroupMembership: normalizeOwnerGroupMembership(
        settings.ownerGroupMembership,
        normalizeOwnerGroups(settings.ownerGroups),
      ),
      mcp: normalizeMcpSettings(settings.mcp),
      web: normalizeWebSettings(settings.web),
      assistantMarketplace: normalizeAssistantMarketplaceSettings(settings.assistantMarketplace),
    };
    this.writeSettingsFile(gatewayCore);
    this.clientKeysStripped = true;
    return mergeClientGatewaySettings(
      { ...DEFAULT_SETTINGS, ...gatewayCore } as AppSettings,
      DEFAULT_CLIENT_SETTINGS,
    );
  }
}
