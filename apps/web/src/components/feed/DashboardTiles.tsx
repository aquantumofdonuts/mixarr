'use client';

import Link from 'next/link';
import { useDashboardStats } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export function DashboardTiles() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useDashboardStats();
  const stats = error ? undefined : data;
  const admin = user?.role === 'admin';
  const summaries = [
    { label: 'Pending discovery records', value: stats?.pendingDiscoveryRecords, href: '/', description: 'Pending and queued artist source records; artists may appear in multiple records.' },
    { label: 'Your pending review records', value: stats?.pendingReviews, href: admin ? undefined : '/queue' },
    { label: 'Active subscriptions', value: stats?.activeSubscriptions },
    { label: 'Results marked added (30d)', value: stats?.subscriptionRecordsMarkedAdded, description: 'Your subscription result records, including legacy records. This is not a distinct artist or confirmed library count.' },
    ...(admin ? [{ label: 'Active connections', value: stats?.activeConnections }] : []),
  ];

  return <section aria-label="Your catalog summary" aria-busy={!!isLoading} className="mb-5 border-y border-border">
    <ul className="grid grid-cols-2 divide-border sm:grid-cols-4 lg:flex lg:flex-wrap">
      {summaries.map(({ label, value, href, description }) => {
        const content = <><span className="block font-mono text-base font-semibold tabular-nums">{value === undefined ? '—' : value.toLocaleString()}</span>{' '}<span className="block text-xs">{label}</span></>;
        return <li key={label} title={description} className="min-w-0 border-b border-border last:border-b-0 sm:border-b-0 lg:flex-1">
          {href ? <Link href={href} className="block px-3 py-2 text-primary hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{content}</Link>
            : <div className="px-3 py-2">{content}</div>}
        </li>;
      })}
    </ul>
    {!admin && <nav aria-label="Your record lists" className="border-t border-border px-3 py-2 text-xs">
      <Link href="/subscriptions" className="text-primary underline">Open your subscriptions</Link>
    </nav>}
    {admin && <nav aria-label="Catalog lists" className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs">
      <Link href="/queue" className="text-primary underline">Open all review records</Link>
      <Link href="/subscriptions" className="text-primary underline">Open your subscriptions</Link>
      <Link href="/connections" className="text-primary underline">Manage connections</Link>
    </nav>}
    {error && <div role="status" className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground"><p>Summary unavailable.</p><Button variant="outline" size="sm" onClick={() => void refetch()}>Retry summary</Button></div>}
  </section>;
}
