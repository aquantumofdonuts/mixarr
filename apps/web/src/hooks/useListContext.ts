'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { updateQuery } from '@/lib/list-state';

export const ListScrollContext = createContext<HTMLElement | null>(null);
interface Snapshot { top: number; selected: string[] }
// ponytail: bounded tab memory is sufficient; no credentials or persistent ledger.
const snapshots = new Map<string, Snapshot>();
const MAX_CONTEXTS = 20, MAX_SELECTION = 500;

function save(key: string, url: string, snapshot: Snapshot) {
  if (url.length > 2048 || [...new URL(url, 'https://mixarr.invalid').searchParams.keys()].some(name => /token|password|secret|credential|^code$|^key$/i.test(name))) return;
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  if (snapshots.size > MAX_CONTEXTS) snapshots.delete(snapshots.keys().next().value!);
}

export function useListContext({ ready }: { ready: boolean }) {
  const pathname = usePathname(), params = useSearchParams(), router = useRouter();
  const { user } = useAuth();
  const scrollElement = useContext(ListScrollContext);
  const parentUrl = `${pathname}${updateQuery(new URLSearchParams(params.toString()), { artist: null })}`;
  const key = `${user?.id}:${parentUrl}`;
  const inspectorOpen = params.has('artist');
  const [selected, setSelection] = useState<Set<string>>(() => new Set(snapshots.get(key)?.selected));
  const selectionRef = useRef(selected);
  const triggerRef = useRef<HTMLElement | null>(null);
  const scopeRef = useRef(key);
  const pendingTop = useRef<number | null>(snapshots.get(key)?.top ?? null);
  const wasOpen = useRef(inspectorOpen);

  const setSelected = useCallback((value: SetStateAction<Set<string>>) => {
    // Resolve functional updates against the current selection, including same-tick calls.
    const next = typeof value === 'function' ? value(selectionRef.current) : value;
    const bounded = new Set([...next].filter(id => id.length <= 200).slice(0, MAX_SELECTION));
    selectionRef.current = bounded;
    setSelection(bounded);
  }, []);

  const remember = useCallback((trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    const top = scrollElement?.scrollTop ?? 0;
    save(key, parentUrl, { top, selected: [...selectionRef.current] });
    pendingTop.current = top;
    return parentUrl;
  }, [key, parentUrl, scrollElement]);

  const closeInspector = useCallback(() => {
    // The current parent scope owns closure, including directly opened inspectors.
    router.replace(parentUrl, { scroll: false });
  }, [parentUrl, router]);

  useLayoutEffect(() => {
    if (scopeRef.current !== key) {
      scopeRef.current = key;
      triggerRef.current = null;
      pendingTop.current = snapshots.get(key)?.top ?? null;
      setSelected(new Set(snapshots.get(key)?.selected));
    } else if (wasOpen.current && !inspectorOpen) {
      pendingTop.current = snapshots.get(key)?.top ?? null;
    }
    wasOpen.current = inspectorOpen;
    if (inspectorOpen || !ready || !scrollElement || pendingTop.current === null) return;

    let frame = 0, lastApplied: number | null = null;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore); });
    const cancel = () => { pendingTop.current = null; cleanup(); };
    const onScroll = () => { if (scrollElement.scrollTop !== lastApplied) cancel(); };
    const onKey = (event: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel(); };
    function cleanup() {
      cancelAnimationFrame(frame); observer.disconnect();
      scrollElement!.removeEventListener('scroll', onScroll);
      scrollElement!.removeEventListener('wheel', cancel);
      scrollElement!.removeEventListener('touchstart', cancel);
      scrollElement!.removeEventListener('keydown', onKey);
    }
    function restore() {
      const top = pendingTop.current;
      if (top === null) return;
      const max = Math.max(0, scrollElement!.scrollHeight - scrollElement!.clientHeight);
      lastApplied = Math.min(top, max);
      scrollElement!.scrollTop = lastApplied;
      if (max >= top) {
        pendingTop.current = null;
        if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
        cleanup();
      }
    }
    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    scrollElement.addEventListener('wheel', cancel, { passive: true });
    scrollElement.addEventListener('touchstart', cancel, { passive: true });
    scrollElement.addEventListener('keydown', onKey);
    observer.observe(scrollElement);
    for (const child of scrollElement.children) observer.observe(child);
    frame = requestAnimationFrame(restore);
    return cleanup;
  }, [key, inspectorOpen, ready, scrollElement, setSelected]);

  return { selected, setSelected, remember, closeInspector, parentUrl };
}
