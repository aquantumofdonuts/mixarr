import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareStartup } from '../../src/lib/startup.js';

afterEach(() => vi.useRealTimers());
describe('startup readiness', () => {
  it('awaits dependency checks and scheduler initialization', async () => {
    const order: string[] = [];
    let restored!: () => void;
    const starting = prepareStartup(async () => { order.push('dependencies'); }, () => {
      order.push('scheduler');
      return new Promise<void>(resolve => { restored = resolve; });
    }).then(() => { order.push('workers', 'listen'); });
    await vi.waitFor(() => expect(order).toEqual(['dependencies', 'scheduler']));
    restored();
    await starting;
    expect(order).toEqual(['dependencies', 'scheduler', 'workers', 'listen']);
  });
  it('retries dependency errors before initializing the scheduler', async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockRejectedValueOnce(new Error('DB starting')).mockResolvedValue(undefined);
    const initialize = vi.fn();
    const starting = prepareStartup(check, initialize);
    await vi.advanceTimersByTimeAsync(500);
    expect(initialize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await starting;
    expect(check).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenCalledOnce();
  });
  it('aborts even a hanging dependency check without initializing the scheduler', async () => {
    const controller = new AbortController();
    const initialize = vi.fn();
    const starting = prepareStartup(() => new Promise(() => {}), initialize, controller.signal);
    const rejected = expect(starting).rejects.toThrow();
    controller.abort();
    await rejected;
    expect(initialize).not.toHaveBeenCalled();
  });
  it('propagates scheduler failure so the caller never starts listening', async () => {
    const listen = vi.fn();
    const starting = prepareStartup(async () => {}, async () => { throw new Error('schedule load failed'); }).then(listen);
    await expect(starting).rejects.toThrow('schedule load failed');
    expect(listen).not.toHaveBeenCalled();
  });
});
