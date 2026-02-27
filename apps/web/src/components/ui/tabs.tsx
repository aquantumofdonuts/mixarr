'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ value, onChange, children, className }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div className={cn('flex gap-2 border-b', className)} role="tablist">
        {children}
      </div>
    </TabsContext.Provider>
  );
}

interface TabProps {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number | string;
  className?: string;
}

const TabsContext = React.createContext<{ value: string; onChange: (v: string) => void } | null>(null);

function useTabsContext() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('Tab must be used within Tabs');
  return ctx;
}

export function Tab({ value, label, icon, badge, className }: TabProps) {
  const { value: selected, onChange } = useTabsContext();
  const isActive = selected === value;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      onClick={() => onChange(value)}
      className={cn(
        'px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
        isActive
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {icon && <span className="inline-flex mr-2 align-middle">{icon}</span>}
      {label}
      {badge != null && <span className="ml-1.5 text-xs text-muted-foreground">({badge})</span>}
    </button>
  );
}
