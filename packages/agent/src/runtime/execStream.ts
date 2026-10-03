/**
 * Cloud sandbox / exec SSE frames aligned to one small model.
 * Desktop agent tools still consume the folded `formatted` string via ExecutionBackend;
 * this codec keeps sandbox SSE from inventing a third state machine.
 */

export type ExecStreamEvent =
  | { type: 'stdout'; chunk: string }
  | { type: 'stderr'; chunk: string }
  | {
      type: 'done';
      cwd?: string;
      shell?: string;
      exitCode?: number | null;
      killed?: boolean;
      aborted?: boolean;
      error?: string | null;
      formatted: string;
    };

export function encodeExecStreamSse(event: ExecStreamEvent): string {
  if (event.type === 'stdout' || event.type === 'stderr') {
    return `event: ${event.type}\ndata: ${JSON.stringify({ chunk: event.chunk })}\n\n`;
  }
  const { type: _t, ...data } = event;
  return `event: done\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Consume sandbox-agent SSE (stdout/stderr/done) into ExecStreamEvent[].
 * Used by remote ExecutionBackend when Accept: text/event-stream.
 */
export function parseExecStreamSseBlocks(buffer: string): {
  events: ExecStreamEvent[];
  rest: string;
} {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() || '';
  const events: ExecStreamEvent[] = [];
  for (const block of parts) {
    let eventName = '';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (eventName === 'stdout' && typeof parsed.chunk === 'string') {
        events.push({ type: 'stdout', chunk: parsed.chunk });
      } else if (eventName === 'stderr' && typeof parsed.chunk === 'string') {
        events.push({ type: 'stderr', chunk: parsed.chunk });
      } else if (eventName === 'done' && typeof parsed.formatted === 'string') {
        events.push({
          type: 'done',
          cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined,
          shell: typeof parsed.shell === 'string' ? parsed.shell : undefined,
          exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : null,
          killed: parsed.killed === true,
          aborted: parsed.aborted === true,
          error: typeof parsed.error === 'string' ? parsed.error : null,
          formatted: parsed.formatted,
        });
      }
    } catch {
      /* ignore */
    }
  }
  return { events, rest };
}

/** Fold stream into the same formatted string JSON mode returns. */
export function foldExecStreamToFormatted(events: ExecStreamEvent[]): string | null {
  const done = [...events].reverse().find((e) => e.type === 'done');
  return done && done.type === 'done' ? done.formatted : null;
}
