import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListScrollContext, useListContext } from '../useListContext';

let params = new URLSearchParams(), userId = 0;
const router = { replace: vi.fn() };
vi.mock('next/navigation', () => ({ usePathname: () => '/search', useSearchParams: () => params, useRouter: () => router }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: userId } }) }));
let resize: () => void;
const disconnect = vi.fn();
let pane: HTMLElement, trigger: HTMLButtonElement, height: number;
const wrapper = ({ children }: { children: React.ReactNode }) => <ListScrollContext.Provider value={pane}>{children}</ListScrollContext.Provider>;
const flushFrame = () => act(() => { vi.runOnlyPendingTimers(); });

beforeEach(() => {
  userId++;
  params = new URLSearchParams('q=jazz&seed=one&seed=two');
  router.replace.mockClear(); disconnect.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  pane = document.createElement('main');
  trigger = document.createElement('button'); trigger.textContent = 'Artist'; pane.append(trigger);
  document.body.append(pane);
  height = 1200;
  Object.defineProperties(pane, { scrollHeight: { get: () => height }, clientHeight: { value: 200 } });
});
afterEach(() => { cleanup(); pane.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('list inspector context', () => {
  it('restores scroll, selection and row focus only after Back data readiness', () => {
    const { result, rerender } = renderHook(({ ready }) => useListContext({ ready }), { wrapper, initialProps: { ready: true } });
    pane.scrollTop = 600;
    act(() => { result.current.setSelected(new Set(['mbid:one', 'mbid:two'])); result.current.remember(trigger); });
    params.set('artist', 'mbid:one'); rerender({ ready: true }); pane.scrollTop = 0;
    params.delete('artist'); rerender({ ready: false }); flushFrame(); expect(pane.scrollTop).toBe(0);
    rerender({ ready: true }); flushFrame();
    expect(pane.scrollTop).toBe(600); expect(trigger).toHaveFocus();
    expect(result.current.selected).toEqual(new Set(['mbid:one', 'mbid:two']));
  });
  it('closes a direct link by removing only the inspector parameter', () => {
    params.set('artist', 'mbid:one');
    const { result } = renderHook(() => useListContext({ ready: true }), { wrapper });
    act(() => result.current.closeInspector());
    expect(router.replace).toHaveBeenCalledWith('/search?q=jazz&seed=one&seed=two', { scroll: false });
  });
  it('waits for content layout and cancels when the user scrolls', () => {
    const { result, rerender } = renderHook(() => useListContext({ ready: true }), { wrapper });
    pane.scrollTop = 600; act(() => result.current.remember(trigger));
    params.set('artist', 'one'); rerender(); pane.scrollTop = 0; height = 300;
    params.delete('artist'); rerender(); flushFrame(); expect(pane.scrollTop).toBe(100);
    pane.dispatchEvent(new Event('scroll')); // Programmatic restoration is ignored.
    height = 1200; act(() => resize()); flushFrame(); expect(pane.scrollTop).toBe(600);
    params.set('artist', 'one'); rerender(); height = 300; pane.scrollTop = 0;
    params.delete('artist'); rerender(); flushFrame();
    pane.scrollTop = 25; pane.dispatchEvent(new Event('scroll'));
    height = 1200; act(() => resize()); flushFrame(); expect(pane.scrollTop).toBe(25);
    expect(disconnect).toHaveBeenCalled();
  });
  it('cancels stale restoration and selection when the committed list scope changes', () => {
    const { result, rerender } = renderHook(() => useListContext({ ready: true }), { wrapper });
    pane.scrollTop = 600;
    act(() => { result.current.setSelected(new Set(['mbid:one'])); result.current.remember(trigger); });
    params.set('artist', 'one'); rerender(); pane.scrollTop = 0;
    params = new URLSearchParams('q=other'); rerender(); flushFrame();
    expect(pane.scrollTop).toBe(0); expect(result.current.selected.size).toBe(0);
  });
  it('cancels frames and observers on unmount', () => {
    const first = renderHook(() => useListContext({ ready: true }), { wrapper });
    pane.scrollTop = 600; act(() => first.result.current.remember(trigger)); first.unmount();
    pane.scrollTop = 0;
    const next = renderHook(() => useListContext({ ready: true }), { wrapper });
    next.unmount(); flushFrame(); expect(pane.scrollTop).toBe(0);
    expect(disconnect).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds stored snapshots without dropping live selections and retains same-tick functional updates', () => {
    const { result, unmount } = renderHook(() => useListContext({ ready: true }), { wrapper });
    act(() => {
      result.current.setSelected(previous => new Set([...previous, 'one']));
      result.current.setSelected(previous => new Set([...previous, 'two']));
    });
    expect(result.current.selected).toEqual(new Set(['one', 'two']));
    act(() => result.current.setSelected(new Set(Array.from({ length: 600 }, (_, i) => `mbid:${i}`))));
    expect(result.current.selected.size).toBe(600);
    act(() => result.current.remember(trigger)); unmount();
    const next = renderHook(() => useListContext({ ready: true }), { wrapper });
    expect(next.result.current.selected.size).toBe(500);
  });
  it('honors user scrolling while data is not ready', () => {
    const { result, rerender } = renderHook(({ ready }) => useListContext({ ready }), { wrapper, initialProps: { ready: true } });
    pane.scrollTop = 600; act(() => result.current.remember(trigger));
    params.set('artist', 'one'); rerender({ ready: true });
    params.delete('artist'); pane.scrollTop = 0; rerender({ ready: false });
    pane.scrollTop = 25; pane.dispatchEvent(new Event('scroll'));
    rerender({ ready: true }); flushFrame(); expect(pane.scrollTop).toBe(25);
  });
  it('saves context on ordinary page navigation without opening an inspector', () => {
    const first = renderHook(() => useListContext({ ready: true }), { wrapper });
    pane.scrollTop = 400;
    act(() => first.result.current.setSelected(new Set(['stable-one'])));
    first.unmount(); pane.scrollTop = 0;
    const next = renderHook(() => useListContext({ ready: true }), { wrapper }); flushFrame();
    expect(pane.scrollTop).toBe(400); expect(next.result.current.selected).toEqual(new Set(['stable-one']));
  });
  it.each([false, true])('preserves the saved target when leaving before restoration finishes (partial layout: %s)', partialLayout => {
    const first = renderHook(() => useListContext({ ready: true }), { wrapper });
    pane.scrollTop = 400; first.unmount(); pane.scrollTop = 0;
    height = partialLayout ? 300 : 1200;
    const loading = renderHook(() => useListContext({ ready: partialLayout }), { wrapper }); flushFrame();
    expect(pane.scrollTop).toBe(partialLayout ? 100 : 0);
    loading.unmount(); pane.scrollTop = 0; height = 1200;
    renderHook(() => useListContext({ ready: true }), { wrapper }); flushFrame(); expect(pane.scrollTop).toBe(400);
  });
  it('keeps tab snapshots isolated by user and excludes token-bearing URLs', () => {
    params.set('token', 'private');
    const first = renderHook(() => useListContext({ ready: true }), { wrapper });
    pane.scrollTop = 600; act(() => first.result.current.remember(trigger)); first.unmount(); pane.scrollTop = 0;
    const next = renderHook(() => useListContext({ ready: true }), { wrapper }); flushFrame(); expect(pane.scrollTop).toBe(0); next.unmount();
    params.delete('token'); userId++;
    renderHook(() => useListContext({ ready: true }), { wrapper }); flushFrame(); expect(pane.scrollTop).toBe(0);
  });
});
