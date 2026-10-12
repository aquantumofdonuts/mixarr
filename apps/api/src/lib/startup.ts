import { setTimeout } from 'node:timers/promises';
import { readBeforeDeadline } from './acquisition-deadline.js';

/** Dependency readiness and schedule restoration must precede accepting requests. */
export async function prepareStartup(
  checkDependencies: () => Promise<unknown>,
  initializeScheduler: () => Promise<void>,
  signal = AbortSignal.timeout(60_000),
): Promise<void> {
  for (;;) {
    signal.throwIfAborted();
    try {
      await readBeforeDeadline(checkDependencies(), signal);
      break;
    } catch {
      signal.throwIfAborted();
      await setTimeout(1000, undefined, { signal });
    }
  }
  await initializeScheduler();
}
