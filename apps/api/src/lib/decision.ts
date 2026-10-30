export class DecisionError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'DecisionError';
  }
}

/** Millisecond database revisions must advance even when the clock stands still. */
export function nextRevision(previous: Array<Date | null>, now = Date.now()): Date {
  return new Date(Math.max(now, ...previous.map(value => value ? value.getTime() + 1 : 0)));
}
