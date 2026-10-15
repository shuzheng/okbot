/** Built-in tool id vocabulary (shared by settings + approval). */

import type { AutoApprovalAction } from './approval.js';

export const TOOL_IDS = ['read_file', 'read_skill', 'write_file', 'edit_file', 'run_shell', 'generate_image', 'search_history', 'manage_schedule', 'web_fetch', 'web_search'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolPreference {
  /** When false, the tool is omitted from the agent. */
  enabled: boolean;
  /** allow = run without HITL; ask = require approval (keyword rules may still auto-allow). */
  approval: AutoApprovalAction;
}

export type ToolPreferences = Record<ToolId, ToolPreference>;

export const DEFAULT_TOOL_PREFERENCES: ToolPreferences = {
  read_file: { enabled: true, approval: 'allow' },
  read_skill: { enabled: true, approval: 'allow' },
  write_file: { enabled: true, approval: 'allow' },
  edit_file: { enabled: true, approval: 'allow' },
  run_shell: { enabled: true, approval: 'allow' },
  generate_image: { enabled: true, approval: 'allow' },
  /** Search this chat only; default allow so gateway/CLI (no HITL card) can use it. */
  search_history: { enabled: true, approval: 'allow' },
  /**
   * Create/list/pause/resume/delete timed wakeups for this assistant/squad.
   * Default allow for list/pause/resume. create/delete still force HITL via
   * needsApproval + resolveToolApproval (AAR cannot bypass).
   */
  manage_schedule: { enabled: true, approval: 'allow' },
  /** Fetch a public URL as readable text; default allow (SSRF guards still apply). */
  web_fetch: { enabled: true, approval: 'allow' },
  /** Third-party web search; needs settings.web.search API key. */
  web_search: { enabled: true, approval: 'allow' },
};

export function normalizeToolPreferences(raw: unknown): ToolPreferences {
  const out: ToolPreferences = {
    run_shell: { ...DEFAULT_TOOL_PREFERENCES.run_shell },
    read_file: { ...DEFAULT_TOOL_PREFERENCES.read_file },
    read_skill: { ...DEFAULT_TOOL_PREFERENCES.read_skill },
    write_file: { ...DEFAULT_TOOL_PREFERENCES.write_file },
    edit_file: { ...DEFAULT_TOOL_PREFERENCES.edit_file },
    generate_image: { ...DEFAULT_TOOL_PREFERENCES.generate_image },
    search_history: { ...DEFAULT_TOOL_PREFERENCES.search_history },
    manage_schedule: { ...DEFAULT_TOOL_PREFERENCES.manage_schedule },
    web_fetch: { ...DEFAULT_TOOL_PREFERENCES.web_fetch },
    web_search: { ...DEFAULT_TOOL_PREFERENCES.web_search },
  };
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Partial<Record<ToolId, Partial<ToolPreference>>>;
  for (const id of TOOL_IDS) {
    const item = obj[id];
    if (!item || typeof item !== 'object') continue;
    out[id] = {
      enabled: item.enabled !== false,
      approval: item.approval === 'allow' ? 'allow' : 'ask',
    };
  }
  return out;
}
