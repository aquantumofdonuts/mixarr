'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface TabsContextValue {
  value: string;
  onChange: (v: string) => void;
  idPrefix: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('Tab must be used within Tabs');
  return ctx;
}

interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ value, onChange, children, className }: TabsProps) {
  const idPrefix = React.useId();

  // Separate Tab children from TabPanel children
  const tabs: React.ReactNode[] = [];
  const panels: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === TabPanel) {
      panels.push(child);
    } else {
      tabs.push(child);
    }
  });

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      const tabElements = Array.from(
        e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      );
      const currentIndex = tabElements.findIndex(
        (tab) => tab.getAttribute('aria-selected') === 'true',
      );
      let nextIndex = currentIndex;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex = (currentIndex + 1) % tabElements.length;
          break;
        case 'ArrowLeft':
          nextIndex = (currentIndex - 1 + tabElements.length) % tabElements.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = tabElements.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      tabElements[nextIndex]?.focus();
      const nextValue = tabElements[nextIndex]?.getAttribute('data-value');
      if (nextValue) onChange(nextValue);
    },
    [onChange],
  );

  return (
    <TabsContext.Provider value={{ value, onChange, idPrefix }}>
      <div
        className={cn('flex gap-2 border-b', className)}
        role="tablist"
        onKeyDown={handleKeyDown}
      >
        {tabs}
      </div>
      {panels}
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

export function Tab({ value, label, icon, badge, className }: TabProps) {
  const { value: selected, onChange, idPrefix } = useTabsContext();
  const isActive = selected === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${idPrefix}-tab-${value}`}
      aria-selected={isActive}
      aria-controls={`${idPrefix}-panel-${value}`}
      tabIndex={isActive ? 0 : -1}
      data-value={value}
      onClick={() => onChange(value)}
      className={cn(
        'min-h-11 px-4 py-2 text-sm border-b-2 transition-colors -mb-px',
        isActive
          ? 'border-foreground bg-muted font-bold text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {icon && <span className="inline-flex mr-2 align-middle">{icon}</span>}
      {label}
      {badge != null && <span className="ml-1.5 font-mono text-xs text-muted-foreground">({badge})</span>}
    </button>
  );
}

interface TabPanelProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className }: TabPanelProps) {
  const { value: selected, idPrefix } = useTabsContext();
  if (selected !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${value}`}
      aria-labelledby={`${idPrefix}-tab-${value}`}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}
