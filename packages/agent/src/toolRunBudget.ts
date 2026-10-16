import { redactSensitiveText } from '@okbot/shared';

const SUMMARY_MAX = 2000;

export function summarizeForTrace(value: unknown, max = SUMMARY_MAX): string {
  let text: string;
  if (value == null) text = '';
  else if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = redactSensitiveText(text);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…(已截断，共 ${text.length} 字符)`;
}

export type ToolRunTraceHooks = {
  onToolRequest?: (info: { name: string; argsSummary: string }) => void;
  onToolResult?: (info: {
    name: string;
    approved: boolean;
    ok: boolean;
    outputSummary?: string;
  }) => void;
};

/**
 * Per user-triggered run: tool-execute counter + optional trace hooks.
 * Count increments only when an approved tool `execute` starts (HITL reject does not count).
 * One instance is shared by captain + nested member tools for squad runs.
 * No per-turn call-count or duration circuit breakers — long runs continue until Stop / abort.
 */
export class ToolRunBudget {
  private count = 0;
  private readonly controller: AbortController;
  private readonly hooks?: ToolRunTraceHooks;

  constructor(controller: AbortController, hooks?: ToolRunTraceHooks) {
    this.controller = controller;
    this.hooks = hooks;
  }

  /** No-op kept for call-site stability (former wall-clock arm). */
  start(): void {}

  /** No-op: duration caps removed; HITL still calls pause/resume around approvals. */
  pauseDuration(): void {}

  /** No-op: duration caps removed. */
  resumeDuration(): void {}

  /** Always false — duration budget no longer exists. */
  isDurationPaused(): boolean {
    return false;
  }

  dispose(): void {}

  /** Shared run AbortSignal (user Stop / steer). */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get toolCallCount(): number {
    return this.count;
  }

  /**
   * Call at the start of tool `execute` (after HITL approve / auto-allow).
   * Increments the counter; never aborts for count/duration limits.
   */
  beforeExecute(name: string, args: unknown): void {
    this.count += 1;
    this.hooks?.onToolRequest?.({
      name,
      argsSummary: summarizeForTrace(args),
    });
  }

  afterExecute(name: string, ok: boolean, output?: unknown): void {
    this.hooks?.onToolResult?.({
      name,
      approved: true,
      ok,
      outputSummary: summarizeForTrace(output),
    });
  }

  /** HITL reject — does not count toward toolCallCount. */
  recordRejection(name: string, args: unknown, message?: string): void {
    this.hooks?.onToolRequest?.({
      name,
      argsSummary: summarizeForTrace(args),
    });
    this.hooks?.onToolResult?.({
      name,
      approved: false,
      ok: false,
      outputSummary: summarizeForTrace(message?.trim() || '用户拒绝了该工具调用'),
    });
  }
}

/**
 * Tools that seal/emit their own mid-run bubbles — skip the shared tool-boundary
 * seal so we do not double-emit (live seal + send_message / ask_assistant).
 */
export const TOOLS_SEAL_THEMSELVES = new Set(['send_message', 'ask_assistant']);

/** Wrap a tool execute so budget + optional trace hooks run around the real body. */
export function wrapToolExecute<TArgs, TResult>(
  name: string,
  budget: ToolRunBudget | undefined,
  execute: (args: TArgs) => Promise<TResult> | TResult,
  /**
   * Fired once per auto-allow / post-HITL tool start (host seals live narration).
   * Skipped for send_message / ask_assistant which seal themselves.
   */
  onBeforeToolExecute?: () => void | Promise<void>,
): (args: TArgs) => Promise<TResult> {
  return async (args) => {
    if (onBeforeToolExecute && !TOOLS_SEAL_THEMSELVES.has(name)) {
      await onBeforeToolExecute();
    }
    if (budget) budget.beforeExecute(name, args);
    try {
      const out = await execute(args);
      if (budget) budget.afterExecute(name, true, out);
      return out;
    } catch (err) {
      if (budget) {
        budget.afterExecute(
          name,
          false,
          err instanceof Error ? err.message : String(err),
        );
      }
      throw err;
    }
  };
}
