import {
  createId,
  isAbortLikeError,
  redactSensitiveText,
  type MessageTrace,
} from '@okbot/shared';
export { isAbortLikeError };
import { ToolRunBudget } from '@okbot/agent';
import { RunTraceRecorder, type RunTraceStatus } from '../storage/runTrace';
import { appendErrorLog, type ErrorLogPhase } from '../storage/errorLog';

export type RunGuards = {
  budget: ToolRunBudget;
  trace: RunTraceRecorder;
  runId: string;
  dispose: () => void;
  /** Finalize message.trace. Call from finally/catch paths. */
  finish: (status: Exclude<RunTraceStatus, 'running'>) => void;
};

export function createRunGuards(input: {
  controller: AbortController;
}): RunGuards {
  const runId = createId('run');
  const trace = new RunTraceRecorder(runId);
  const budget = new ToolRunBudget(input.controller, {
    onToolRequest: (info) => {
      trace.beginTool(info.name, info.argsSummary);
    },
    onToolResult: (info) => {
      trace.endTool(info.name, {
        approved: info.approved,
        ok: info.ok,
        ...(info.outputSummary != null ? { outputSummary: info.outputSummary } : {}),
      });
    },
  });
  budget.start();
  let finished = false;
  return {
    budget,
    trace,
    runId,
    dispose: () => budget.dispose(),
    finish: (status) => {
      if (finished) return;
      finished = true;
      budget.dispose();
      trace.finish(status);
    },
  };
}


/** Span hooks for runAgentChat / runSquadChat (feeds message.trace waterfall). */
export function attachTraceHooks(guards: RunGuards) {
  return {
    onModelTurnStart: () => guards.trace.beginModel(),
    onModelTurnEnd: (info: { ok: boolean; error?: string; spanId?: string }) => {
      guards.trace.endModel({
        status: info.ok ? ('ok' as const) : ('error' as const),
        ...(info.error ? { error: redactSensitiveText(info.error) } : {}),
        ...(info.spanId ? { spanId: info.spanId } : {}),
      });
    },
    onApprovalWaitStart: (toolName: string) => guards.trace.beginApproval(toolName),
    onApprovalWaitEnd: (info: { toolName: string; approved: boolean; spanId?: string }) => {
      guards.trace.endApproval({
        approved: info.approved,
        ...(info.spanId ? { spanId: info.spanId } : {}),
      });
    },
  };
}

/** Finish the run trace and return a copy for ChatMessage.trace / done events. */
export function sealMessageTrace(
  guards: RunGuards,
  status: Exclude<RunTraceStatus, 'running'>,
): MessageTrace | undefined {
  guards.finish(status);
  return guards.trace.getMessageTrace() ?? undefined;
}

export function resolveRunFinishStatus(input: {
  err?: unknown;
  aborted: boolean;
}): Exclude<RunTraceStatus, 'running'> {
  if (input.aborted || isAbortLikeError(input.err)) return 'aborted';
  if (input.err) return 'error';
  return 'done';
}

/** Shared catch path: error log + seal message.trace. Returns Chinese-facing message. */
export function handleRunFailure(input: {
  root: string;
  ownerId: string;
  messageId: string;
  phase: ErrorLogPhase;
  err: unknown;
  guards: RunGuards;
}): string {
  const raw =
    input.err instanceof Error ? input.err.message : String(input.err);
  const message = redactSensitiveText(raw);
  appendErrorLog(input.root, {
    ownerId: input.ownerId,
    messageId: input.messageId,
    phase: input.phase,
    error: message,
  });
  input.guards.finish(resolveRunFinishStatus({ err: input.err, aborted: false }));
  return message;
}
