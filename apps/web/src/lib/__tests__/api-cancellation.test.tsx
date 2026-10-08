import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useSubscriptionResults } from '../hooks';

let signals: AbortSignal[];
beforeEach(() => {
  signals = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    const signal = options.signal!;
    signals.push(signal);
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('request cancellation', () => {
  it('composes caller cancellation with the request timeout and rejects cancellation', async () => {
    const controller = new AbortController();
    const request = api.get('/api/items', { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(signals[0].aborted).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/items', expect.objectContaining({ credentials: 'include' }));
  });
  it('still reports a concrete timeout when the caller has not cancelled', async () => {
    const controller = new AbortController();
    const result = await api.get('/api/items', { signal: controller.signal, timeoutMs: 5 });
    expect(result).toEqual({ data: null, error: 'Request timed out after 0s', status: 0 });
    expect(controller.signal.aborted).toBe(false);
    expect(signals[0].aborted).toBe(true);
  });
  it('aborts the real fetch for obsolete query pages and on unmount', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { rerender, unmount } = renderHook(({ page }) => useSubscriptionResults(7, 'pending', page), { wrapper, initialProps: { page: 0 } });
    await waitFor(() => expect(signals).toHaveLength(1));
    rerender({ page: 1 });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    act(() => unmount());
    expect(signals[1].aborted).toBe(true);
    client.clear();
  });
});
