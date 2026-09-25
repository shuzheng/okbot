import { redactSensitiveText, type ToolRunSettings } from '@okbot/shared';

const SUMMARY_MAX = 2000;

/** Hard circuit-break abort (max tool calls / max duration). */
export class CircuitBreakError extends Error {
  readonly code = 'circuit_break' as const;
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakError';
  }
}

export function isCircuitBreakError(err: unknown): err is CircuitBreakError {
  return (
    err instanceof CircuitBreakError ||
    (err instanceof Error &&
      (err as { code?: string }).code === 'circuit_break' &&
      err.name === 'CircuitBreakError')
  );
}

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
  onCircuitBreak?: (reason: string) => void;
};

/**
 * Per user-triggered run: wall-clock duration + tool-execute counter.
 * Count increments only when an approved tool `execute` starts (HITL reject does not count).
 * One instance is shared by captain + nested member tools for squad runs.
 */
export class ToolRunBudget {
  readonly maxToolCalls: number;
  readonly maxDurationSec: number;
  private count = 0;
  private readonly startedAt = Date.now();
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private breakReason: string | null = null;
  /** Wall time spent paused (HITL approval wait); excluded from maxDurationSec. */
  private pausedAccumMs = 0;
  private pauseStartedAt: number | null = null;
  private readonly controller: AbortController;
  private readonly hooks?: ToolRunTraceHooks;

  constructor(
    settings: Pick<ToolRunSettings, 'maxToolCalls' | 'maxDurationSec'>,
    controller: AbortController,
    hooks?: ToolRunTraceHooks,
  ) {
    this.maxToolCalls = settings.maxToolCalls;
    this.maxDurationSec = settings.maxDurationSec;
    this.controller = controller;
    this.hooks = hooks;
  }

  /** Arm wall-clock timer (call once when the chat run starts). */
  start(): void {
    this.armTimeout();
  }

  private effectiveElapsedMs(): number {
    const pausedExtra =
      this.pauseStartedAt != null ? Date.now() - this.pauseStartedAt : 0;
    return Date.now() - this.startedAt - this.pausedAccumMs - pausedExtra;
  }

  private armTimeout(): void {
    if (this.maxDurationSec <= 0) return;
    if (this.timeoutId != null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.pauseStartedAt != null) return; // paused — wait for resume
    const remainingMs = this.maxDurationSec * 1000 - this.effectiveElapsedMs();
    if (remainingMs <= 0) {
      const reason = `运行已超过最大时长限制（${this.maxDurationSec} 秒），已中止。`;
      this.triggerBreak(reason);
      return;
    }
    this.timeoutId = setTimeout(() => {
      const reason = `运行已超过最大时长限制（${this.maxDurationSec} 秒），已中止。`;
      this.triggerBreak(reason);
    }, remainingMs);
  }

  /**
   * Pause the duration budget (HITL approval wait). Nested pauses are ignored.
   * Does not pause maxToolCalls counting.
   */
  pauseDuration(): void {
    if (this.pauseStartedAt != null) return;
    this.pauseStartedAt = Date.now();
    if (this.timeoutId != null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /** Resume after {@link pauseDuration}; re-arms the remaining wall-clock budget. */
  resumeDuration(): void {
    if (this.pauseStartedAt == null) return;
    this.pausedAccumMs += Date.now() - this.pauseStartedAt;
    this.pauseStartedAt = null;
    if (!this.breakReason) this.armTimeout();
  }

  dispose(): void {
    if (this.timeoutId != null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.pauseStartedAt = null;
  }

  getBreakReason(): string | null {
    return this.breakReason;
  }

  /** Shared run AbortSignal (user Stop / circuit-break / steer). */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get toolCallCount(): number {
    return this.count;
  }

  private triggerBreak(reason: string): void {
    if (this.breakReason) return;
    this.breakReason = reason;
    this.hooks?.onCircuitBreak?.(reason);
    try {
      this.controller.abort(reason);
    } catch {
      this.controller.abort();
    }
  }

  /** Throw if duration already exceeded or a prior break was triggered. */
  assertWithinLimits(): void {
    if (this.breakReason) {
      throw new CircuitBreakError(this.breakReason);
    }
    if (this.maxDurationSec > 0) {
      const elapsedSec = this.effectiveElapsedMs() / 1000;
      if (elapsedSec >= this.maxDurationSec) {
        const reason = `运行已超过最大时长限制（${this.maxDurationSec} 秒），已中止。`;
        this.triggerBreak(reason);
        throw new CircuitBreakError(reason);
      }
    }
  }

  /**
   * Call at the start of tool `execute` (after HITL approve / auto-allow).
   * Increments the counter; throws CircuitBreakError when the next call would exceed max.
   */
  beforeExecute(name: string, args: unknown): void {
    this.assertWithinLimits();
    if (this.maxToolCalls > 0 && this.count + 1 > this.maxToolCalls) {
      const reason = `本轮工具调用已达上限（${this.maxToolCalls} 次），已中止。`;
      this.triggerBreak(reason);
      throw new CircuitBreakError(reason);
    }
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

  /** HITL reject — does not count toward maxToolCalls. */
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

/** Wrap a tool execute so budget + optional trace hooks run around the real body. */
export function wrapToolExecute<TArgs, TResult>(
  name: string,
  budget: ToolRunBudget | undefined,
  execute: (args: TArgs) => Promise<TResult> | TResult,
): (args: TArgs) => Promise<TResult> {
  if (!budget) {
    return async (args) => execute(args);
  }
  return async (args) => {
    budget.beforeExecute(name, args);
    try {
      const out = await execute(args);
      budget.afterExecute(name, true, out);
      return out;
    } catch (err) {
      if (!isCircuitBreakError(err)) {
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
