'use client';

import { useRef } from 'react';
import Link from 'next/link';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { subscriptionTypes, scheduleOptions } from '@/lib/subscription-constants';
import { buildSubscriptionDescriptor } from '@/lib/subscription-descriptor';

/**
 * User type for ownership display
 */
export interface User {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

/**
 * Subscription data structure
 */
export interface Subscription {
  id: number;
  userId: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  schedule: string | null;
  resultHandling: 'preview' | 'queue' | 'auto';
  isActive: boolean;
  lastRun: string | null;
  lastRunStatus: 'success' | 'completed' | 'failed' | 'running' | null;
  lastRunCount: number | null;
  nextRun: string | null;
  user?: { username: string; displayName: string };
}

export interface SubscriptionCardProps {
  /** The subscription data to display */
  subscription: Subscription;
  /** Current authenticated user (for admin badge display) */
  currentUser: User | null;
  /** Whether the subscription is currently being executed */
  isRunning: boolean;
  /** Handler for running the subscription */
  onRun: (id: number) => void;
  /** Handler for toggling the subscription active state */
  onToggle: (subscription: Subscription) => void;
  /** Handler for editing the subscription */
  onEdit: (subscription: Subscription) => void;
  /** Handler for deleting the subscription */
  onDelete: (id: number) => void;
}

export function SubscriptionCard({ subscription: sub, currentUser: user, isRunning, onRun, onToggle, onEdit, onDelete }: SubscriptionCardProps) {
  const overflow = useRef<HTMLDetailsElement>(null);
  const typeLabel = subscriptionTypes.find(type => type.value === sub.type)?.label || sub.type;
  const descriptor = buildSubscriptionDescriptor(sub.type, sub.config, typeLabel);
  const name = sub.name || descriptor;
  const scheduleLabel = scheduleOptions.find(option => option.value === (sub.schedule || ''))?.label || sub.schedule;
  const runStatus = sub.lastRunStatus === 'completed' || sub.lastRunStatus === 'success' ? 'Completed' : sub.lastRunStatus === 'failed' ? 'Failed' : sub.lastRunStatus === 'running' ? 'Running' : 'Status unavailable';
  const closeOverflow = () => {
    if (overflow.current) {
      overflow.current.open = false;
      overflow.current.querySelector('summary')?.focus();
    }
  };

  return (
    <article className="border-b border-border py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 break-words font-semibold"><Link href={`/subscriptions/${sub.id}`} className="text-primary hover:underline">{name}</Link></h3>
            {sub.schedule && <Badge variant="secondary">{sub.isActive ? 'Schedule active' : 'Schedule paused'}</Badge>}
            {user?.role === 'admin' && sub.user && sub.userId !== user.id && <Badge variant="outline">{sub.user.displayName || sub.user.username}</Badge>}
          </div>
          {descriptor !== name && <p className="mt-1 break-words text-sm text-muted-foreground">{descriptor}</p>}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{scheduleLabel}</span>
            {sub.lastRun || sub.lastRunStatus ? <span><span className={sub.lastRunStatus === 'failed' ? 'text-destructive' : undefined}>Last run: {runStatus}{sub.lastRunCount !== null && <> · <span className="font-mono">{sub.lastRunCount}</span> records marked added or queued</>}</span>{sub.lastRun && <> · <time dateTime={sub.lastRun}>{new Date(sub.lastRun).toLocaleString()}</time></>}</span> : <span>Not run yet</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/subscriptions/${sub.id}?tab=results`} className="inline-flex min-h-11 items-center px-2 text-sm text-primary hover:underline">View results</Link>
          <Button variant="outline" size="sm" onClick={() => onRun(sub.id)} disabled={isRunning}>Run now</Button>
          <Button variant="outline" size="sm" onClick={() => onToggle(sub)}>{sub.isActive ? 'Pause schedule' : 'Resume schedule'}</Button>
          <details ref={overflow} className="group relative">
            <summary aria-label={`More actions for ${name}`} className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-button border border-border px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden="true" className="h-4 w-4 transition-transform duration-[140ms] ease-in-out group-open:rotate-90" />
              <span>More actions</span>
            </summary>
            <div className="absolute right-0 top-full z-10 mt-1 flex w-44 flex-col items-stretch gap-1 rounded-button border border-border bg-background p-1 shadow-sm">
              <Button variant="ghost" size="sm" onClick={() => { closeOverflow(); onEdit(sub); }}>Edit subscription</Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { closeOverflow(); onDelete(sub.id); }}>Delete subscription</Button>
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}
