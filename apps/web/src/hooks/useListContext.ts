'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { updateQuery } from '@/lib/list-state';

export const ListScrollContext = createContext<HTMLElement | null>(null);
interface Snapshot { top: number; selected: string[] }
// bounded tab memory is sufficient; no credentials or persistent ledger.
const snapshots = new Map<string, Snapshot>();
const MAX_CONTEXTS = 20, MAX_SELECTION = 500;

function save(key: string, url: string, snapshot: Snapshot) {
  if (url.length > 2048 || [...new URL(url, 'https://mixarr.invalid').searchParams.keys()].some(name => /token|password|secret|credential|^code$|^key$/i.test(name))) return;
  snapshots.delete(key);
  snapshots.set(key, { top: snapshot.top, selected: snapshot.selected.filter(id => id.length <= 200).slice(0, MAX_SELECTION) });
  if (snapshots.size > MAX_CONTEXTS) snapshots.delete(snapshots.keys().next().value!);
}

export function useListContext({ ready, selectionOwner = true, restore: restoreScroll = true, retainSelectionOnScopeChange = false }: { ready: boolean; selectionOwner?: boolean; restore?: boolean; retainSelectionOnScopeChange?: boolean }) {
  const pathname = usePathname(), params = useSearchParams(), router = useRouter();
  const { user } = useAuth();
  const scrollElement = useContext(ListScrollContext);
  const parentUrl = `${pathname}${updateQuery(new URLSearchParams(params.toString()), { artist: null })}`;
  const key = `${user?.id}:${parentUrl}`;
  const selectionScope = `${user?.id}:${pathname}`;
  const inspectorOpen = params.has('artist');
  const [selected, setSelection] = useState<Set<string>>(() => new Set(snapshots.get(key)?.selected));
  const selectionRef = useRef(selected);
  const triggerRef = useRef<HTMLElement | null>(null);
  const scopeRef = useRef(key);
  const selectionScopeRef = useRef(selectionScope);
  const pendingTop = useRef<number | null>(snapshots.get(key)?.top ?? null);
  const wasOpen = useRef(inspectorOpen);

  const setSelected = useCallback((value: SetStateAction<Set<string>>) => {
    // Resolve functional updates against the current selection, including same-tick calls.
    const next = typeof value === 'function' ? value(selectionRef.current) : value;
    const selection = new Set(next);
    selectionRef.current = selection;
    setSelection(selection);
  }, []);

  const remember = useCallback((trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    const top = scrollElement?.scrollTop ?? 0;
    save(key, parentUrl, { top, selected: selectionOwner ? [...selectionRef.current] : snapshots.get(key)?.selected ?? [] });
    pendingTop.current = top;
    return parentUrl;
  }, [key, parentUrl, scrollElement, selectionOwner]);

  const closeInspector = useCallback(() => {
    // The current parent scope owns closure, including directly opened inspectors.
    router.replace(parentUrl, { scroll: false });
  }, [parentUrl, router]);

  useLayoutEffect(() => {
    if (!restoreScroll || !scrollElement || inspectorOpen) return;
    return () => save(key, parentUrl, { top: pendingTop.current ?? scrollElement.scrollTop, selected: selectionOwner ? [...selectionRef.current] : snapshots.get(key)?.selected ?? [] });
  }, [key, parentUrl, scrollElement, inspectorOpen, selectionOwner, restoreScroll]);

  useLayoutEffect(() => {
    if (scopeRef.current !== key) {
      const sameSelectionOwner = selectionScopeRef.current === selectionScope;
      scopeRef.current = key;
      selectionScopeRef.current = selectionScope;
      triggerRef.current = null;
      pendingTop.current = snapshots.get(key)?.top ?? null;
      // Search retains current selection until successful replacement results prune it.
      if (!retainSelectionOnScopeChange || !sameSelectionOwner) setSelected(new Set(snapshots.get(key)?.selected));
    } else if (wasOpen.current && !inspectorOpen) {
      pendingTop.current = snapshots.get(key)?.top ?? null;
    }
    wasOpen.current = inspectorOpen;
    if (!restoreScroll || inspectorOpen || !scrollElement || pendingTop.current === null) return;

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
      if (top === null || !ready) return;
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
  }, [key, selectionScope, inspectorOpen, ready, scrollElement, setSelected, restoreScroll, retainSelectionOnScopeChange]);

  return { selected, setSelected, remember, closeInspector, parentUrl };
}
