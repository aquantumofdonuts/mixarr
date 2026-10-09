'use client';

import * as React from 'react';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Info from 'lucide-react/dist/esm/icons/info';
import X from 'lucide-react/dist/esm/icons/x';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import { cn } from '@/lib/utils';
import { Button } from './button';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}
interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  isCurrent: () => boolean;
}
const ToastContext = React.createContext<ToastContextValue | null>(null);
export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);
  const mounted = React.useRef(true);
  const isCurrent = React.useCallback(() => mounted.current, []);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const removeToast = React.useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts(previous => previous.filter(toast => toast.id !== id));
  }, []);
  const addToast = React.useCallback((toast: Omit<Toast, 'id'>) => {
    if (!mounted.current) return;
    const id = `toast-${++nextId.current}`;
    setToasts(previous => [...previous, { ...toast, id }]);
    // Actionable feedback (including Undo) gets ten seconds by default.
    const duration = toast.duration ?? (toast.action ? 10_000 : 5_000);
    if (duration > 0) timers.current.set(id, setTimeout(() => removeToast(id), duration));
  }, [removeToast]);
  React.useEffect(() => {
    mounted.current = true;
    const activeTimers = timers.current;
    return () => { mounted.current = false; activeTimers.forEach(clearTimeout); activeTimers.clear(); };
  }, []);

  return <ToastContext.Provider value={{ toasts, addToast, removeToast, isCurrent }}>
    {children}
    <div aria-label="Notifications" role="region" className="fixed bottom-4 left-3 right-3 z-50 flex flex-col gap-2 sm:left-auto sm:w-[25rem] sm:max-w-[calc(100vw-1.5rem)]">
      {toasts.map(toast => {
        const Icon = icons[toast.type];
        return <div key={toast.id} role={toast.type === 'error' ? 'alert' : 'status'} aria-atomic="true"
          className="flex items-start gap-3 rounded-container border bg-card p-3 text-card-foreground shadow-sm">
          <Icon aria-hidden="true" className={cn('mt-1 h-5 w-5 shrink-0', iconColors[toast.type])} />
          <div className="min-w-0 flex-1 break-words">
            <p className="font-medium">{toast.title}</p>
            {toast.message && <p className="mt-1 text-sm text-muted-foreground">{toast.message}</p>}
            {toast.action && <Button variant="outline" className="mt-2" onClick={toast.action.onClick}>{toast.action.label}</Button>}
          </div>
          <button type="button" aria-label={`Dismiss ${toast.title}`} onClick={() => removeToast(toast.id)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-button hover:bg-muted">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>;
      })}
    </div>
  </ToastContext.Provider>;
}
const icons = { success: CheckCircle2, error: XCircle, warning: AlertCircle, info: Info };
const iconColors = { success: 'text-status-success', error: 'text-status-error', warning: 'text-status-warning', info: 'text-muted-foreground' };
