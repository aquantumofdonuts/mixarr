import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFrontierStream, isCurrentGeneration } from '../useFrontierStream';
import type { StreamToken } from '@/types/constellation';

/** Minimal EventSource stand-in (jsdom has no EventSource). */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  /** Simulate a successful connection open. */
  open(): void {
    this.onopen?.(new Event('open'));
  }

  /** Simulate a transport error (native EventSource would then auto-reconnect). */
  fail(): void {
    this.onerror?.(new Event('error'));
  }

  /** Simulate a server `data:` frame. */
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  /** Simulate a raw (possibly malformed) server `data:` frame. */
  emitRaw(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  static latest(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }

  static reset(): void {
    MockEventSource.instances = [];
  }
}

beforeEach(() => {
  MockEventSource.reset();
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const token = (id: string, generation: number): StreamToken => ({ id, generation });

describe('isCurrentGeneration', () => {
  it('accepts a payload whose generation matches', () => {
    expect(isCurrentGeneration({ generation: 3 }, 3)).toBe(true);
  });

  it('rejects a payload from a stale (older) generation', () => {
    expect(isCurrentGeneration({ generation: 2 }, 3)).toBe(false);
  });

  it('rejects a payload with no generation', () => {
    expect(isCurrentGeneration({}, 3)).toBe(false);
  });
});

describe('useFrontierStream', () => {
  it('opens an EventSource for the token id', () => {
    renderHook(() => useFrontierStream(token('tok-1', 1), vi.fn()));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.latest().url).toContain('/api/constellation/stream/tok-1');
  });

  it('does not open a stream when the token is null', () => {
    renderHook(() => useFrontierStream(null, vi.fn()));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('forwards an event carrying the CURRENT generation to onNodes', () => {
    const onNodes = vi.fn();
    renderHook(() => useFrontierStream(token('tok-1', 4), onNodes));

    act(() => {
      MockEventSource.latest().emit({ generation: 4, personId: 99 });
    });

    expect(onNodes).toHaveBeenCalledTimes(1);
    expect(onNodes).toHaveBeenCalledWith({ generation: 4, personId: 99 });
  });

  it('DISCARDS an event from a stale generation (re-center race guard)', () => {
    const onNodes = vi.fn();
    renderHook(() => useFrontierStream(token('tok-1', 5), onNodes));

    act(() => {
      // generation 3 is older than the token's current generation 5.
      MockEventSource.latest().emit({ generation: 3, personId: 42 });
    });

    expect(onNodes).not.toHaveBeenCalled();
  });

  it('closes the old EventSource when the token changes (re-center teardown)', () => {
    const onNodes = vi.fn();
    const { rerender } = renderHook(
      ({ t }: { t: StreamToken }) => useFrontierStream(t, onNodes),
      { initialProps: { t: token('tok-1', 1) } },
    );

    const first = MockEventSource.latest();
    expect(first.closed).toBe(false);

    // Re-center → new token id + generation.
    rerender({ t: token('tok-2', 2) });

    expect(first.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.latest().closed).toBe(false);
  });

  it('closes the EventSource on unmount (no leak)', () => {
    const { unmount } = renderHook(() => useFrontierStream(token('tok-1', 1), vi.fn()));
    const source = MockEventSource.latest();
    unmount();
    expect(source.closed).toBe(true);
  });

  it('ignores a malformed (non-JSON) frame without crashing or calling onNodes', () => {
    const onNodes = vi.fn();
    const { result } = renderHook(() => useFrontierStream(token('tok-1', 1), onNodes));

    expect(() => {
      act(() => {
        MockEventSource.latest().emitRaw('{ this is : not json');
      });
    }).not.toThrow();

    expect(onNodes).not.toHaveBeenCalled();
    // A following well-formed frame is still processed.
    act(() => {
      MockEventSource.latest().emit({ generation: 1, personId: 7 });
    });
    expect(onNodes).toHaveBeenCalledWith({ generation: 1, personId: 7 });
    expect(result.current.error).toBeNull();
  });

  it('reports connected after a successful open', () => {
    const { result } = renderHook(() => useFrontierStream(token('tok-1', 1), vi.fn()));
    expect(result.current.connected).toBe(false);
    act(() => {
      MockEventSource.latest().open();
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('closes the stream and surfaces an error after repeated errors past the cap', () => {
    const { result } = renderHook(() => useFrontierStream(token('tok-1', 1), vi.fn()));
    const source = MockEventSource.latest();

    // Two errors: under the cap of 3 — still trying, not abandoned.
    act(() => {
      source.fail();
      source.fail();
    });
    expect(source.closed).toBe(false);
    expect(result.current.error).toBeNull();

    // Third consecutive error hits the cap: closed + error surfaced.
    act(() => {
      source.fail();
    });
    expect(source.closed).toBe(true);
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe('Live updates unavailable');
  });

  it('resets the error streak on a successful open between failures', () => {
    const { result } = renderHook(() => useFrontierStream(token('tok-1', 1), vi.fn()));
    const source = MockEventSource.latest();

    act(() => {
      source.fail();
      source.fail();
      // A reconnect succeeds → streak resets.
      source.open();
      // Two more errors: only 2 consecutive now, still under the cap.
      source.fail();
      source.fail();
    });

    expect(source.closed).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
