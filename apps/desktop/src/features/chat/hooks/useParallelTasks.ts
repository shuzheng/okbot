import { useRef, useState } from 'react';
import {
  removeParallelTask,
  upsertParallelTask,
  type ParallelTask,
} from '../ParallelTasksStrip';

/**
 * Parallel turn strip state + in-flight send counters.
 * Chat event routing mutates these via the returned setters/refs.
 */
export function useParallelTasks() {
  const [parallelTasksByOwner, setParallelTasksByOwner] = useState<
    Record<string, ParallelTask[]>
  >({});
  /** Count of renderer chatStart awaits per owner — keeps BorderBeam up while any parallel turn wraps up. */
  const sendsInFlightRef = useRef<Record<string, number>>({});

  return {
    parallelTasksByOwner,
    setParallelTasksByOwner,
    sendsInFlightRef,
    upsertParallelTask,
    removeParallelTask,
  };
}
