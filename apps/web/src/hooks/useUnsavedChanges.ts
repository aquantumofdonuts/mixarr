'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface DirtyRegistry {
  hasUnsavedChanges: boolean;
  register: (id: symbol, dirty: boolean) => () => void;
  confirmDiscard: () => boolean;
  guardedNavigation: (action: () => void) => boolean;
}
const empty: DirtyRegistry = {
  hasUnsavedChanges: false,
  register: () => () => {},
  confirmDiscard: () => true,
  guardedNavigation: (action: () => void) => { action(); return true; },
};
const UnsavedChangesContext = createContext(empty);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<symbol, boolean>());
  const bypassUnload = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const register = useCallback((id: symbol, dirty: boolean) => {
    entries.current.set(id, dirty);
    setHasUnsavedChanges([...entries.current.values()].some(Boolean));
    return () => {
      entries.current.delete(id);
      setHasUnsavedChanges([...entries.current.values()].some(Boolean));
    };
  }, []);
  const confirmDiscard = useCallback(() => ![...entries.current.values()].some(Boolean) || window.confirm('Discard unsaved settings changes?'), []);
  const guardedNavigation = useCallback((action: () => void) => {
    if (!confirmDiscard()) return false;
    // ponytail: the explicit discard dialog replaces the native unload prompt for this one action.
    bypassUnload.current = true;
    try { action(); } finally {
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => { bypassUnload.current = false; }, 0);
    }
    return true;
  }, [confirmDiscard]);
  useLayoutEffect(() => {
    // ponytail: read the live registry so protection does not wait for a second render.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (bypassUnload.current || ![...entries.current.values()].some(Boolean)) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  useEffect(() => {
    const boundary = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element)?.closest?.('a');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const target = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      const settingsRoute = (path: string) => path === '/settings' || path.startsWith('/settings/');
      if (target.origin !== current.origin || (!settingsRoute(target.pathname) && !settingsRoute(current.pathname))) return;
      if (target.href === current.href || (target.pathname === current.pathname && target.search === current.search && target.hash)) return;
      event.preventDefault(); event.stopPropagation();
      // Native documents make browser Back eligible for beforeunload without patching Next history.
      window.location.assign(target.href);
    };
    document.addEventListener('click', boundary, true);
    return () => { document.removeEventListener('click', boundary, true); clearTimeout(resetTimer.current); };
  }, []);
  return createElement(UnsavedChangesContext.Provider, { value: { hasUnsavedChanges, register, confirmDiscard, guardedNavigation } }, children);
}

export function useUnsavedChanges(dirty?: boolean) {
  const context = useContext(UnsavedChangesContext);
  const { register } = context;
  const id = useRef(Symbol('settings draft'));
  useLayoutEffect(() => dirty === undefined ? undefined : register(id.current, dirty), [register, dirty]);
  return context;
}
