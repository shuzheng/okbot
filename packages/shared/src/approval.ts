/** Auto-approval (AAR) policy types and HITL helpers. */

import { isMcpToolName } from './mcp.js';
import { TOOL_IDS } from './toolIds.js';

export type AutoApprovalAction = 'allow' | 'ask';

/** One auto-approval rule: keywords matched against tool name + arguments. */
export interface AutoApprovalRule {
  id: string;
  /** Keywords / short phrase; matched case-insensitively against the tool call. */
  description: string;
  action: AutoApprovalAction;
  createdAt: string;
  updatedAt: string;
}

export function toolCallHaystack(toolName: string, toolArgs: unknown): string {
  let argsText = '';
  try {
    argsText = typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs ?? {}, null, 0);
  } catch {
    argsText = String(toolArgs ?? '');
  }
  return `${toolName}\n${argsText}`.toLowerCase();
}

/**
 * Decide HITL outcome from auto-approval settings.
 * When disabled or no match → ask. If any matching rule is ask → ask (ask wins).
 * Otherwise if any matching rule is allow → allow.
 */
export function resolveAutoApproval(
  enabled: boolean,
  rules: AutoApprovalRule[] | undefined,
  toolName: string,
  toolArgs: unknown,
): AutoApprovalAction {
  if (!enabled) return 'ask';
  const list = Array.isArray(rules) ? rules : [];
  const haystack = toolCallHaystack(toolName, toolArgs);
  let matchedAsk = false;
  let matchedAllow = false;
  for (const rule of list) {
    if (!ruleMatchesKeywords(rule?.description ?? '', haystack)) continue;
    if (rule.action === 'ask') matchedAsk = true;
    else if (rule.action === 'allow') matchedAllow = true;
  }
  if (matchedAsk) return 'ask';
  if (matchedAllow) return 'allow';
  return 'ask';
}

/** Rule text that is exactly a built-in tool id matches that tool by name only. */
const BUILT_IN_TOOL_RULE_IDS: ReadonlySet<string> = new Set<string>(TOOL_IDS);

/**
 * Tool approval for one call. MCP tools (`mcp_` prefix) always ask: keyword rules
 * written for built-in tools (for example `run_shell`) must not match
 * `mcp_<server>_run_shell`, and MCP calls are never whitelisted.
 */
/** manage_schedule create/delete always HITL — AAR / settings allow must not bypass. */
export function manageScheduleActionRequiresConfirm(toolArgs: unknown): boolean {
  if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) return false;
  const action = String((toolArgs as { action?: unknown }).action || '').trim().toLowerCase();
  return action === 'create' || action === 'delete';
}

export function resolveToolApproval(
  settings: { autoApprovalEnabled?: boolean; autoApprovalRules?: AutoApprovalRule[] },
  toolName: string,
  toolArgs: unknown,
): AutoApprovalAction {
  if (isMcpToolName(toolName)) return 'ask';
  if (toolName === 'manage_schedule' && manageScheduleActionRequiresConfirm(toolArgs)) return 'ask';
  return resolveAutoApproval(settings.autoApprovalEnabled === true, settings.autoApprovalRules, toolName, toolArgs);
}

function ruleMatchesKeywords(description: string, haystack: string): boolean {
  const raw = description.trim().toLowerCase();
  if (!raw) return false;
  if (BUILT_IN_TOOL_RULE_IDS.has(raw)) {
    const nl = haystack.indexOf('\n');
    return (nl >= 0 ? haystack.slice(0, nl) : haystack) === raw;
  }
  if (haystack.includes(raw)) return true;
  const parts = raw
    .split(/[,，、;；\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length <= 1) return haystack.includes(raw);
  // Comma-separated keywords: any phrase matches (OR).
  return parts.some((p) => haystack.includes(p));
}
