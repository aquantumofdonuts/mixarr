'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, Skeleton, Button } from '@/components/ui';
import { FeedCard } from './FeedCard';
import Calendar from 'lucide-react/dist/esm/icons/calendar';
import type { FeedItem } from '@/lib/hooks';

export interface FeedGridProps {
  items: FeedItem[];
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading?: boolean;
  loadingIds?: Set<string>;
  view?: 'list' | 'artwork';
  onOpen?: (trigger: HTMLElement) => void;
}

export function FeedGrid({
  items,
  onApprove,
  onDismiss,
  onLoadMore,
  hasMore,
  isLoading = false,
  loadingIds = new Set(),
  view = 'list',
  onOpen,
}: FeedGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    if (!hasMore || isLoading || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    const sentinel = sentinelRef.current;
    if (sentinel) {
      observer.observe(sentinel);
    }

    return () => {
      if (sentinel) {
        observer.unobserve(sentinel);
      }
      observer.disconnect();
    };
  }, [hasMore, isLoading, onLoadMore]);

  const router = useRouter();

  // Skeleton loading state
  if (isLoading && items.length === 0) {
    return (
      <div className="space-y-3" aria-label="Loading discovery">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20">
            <Skeleton className="w-full h-full rounded-container" />
          </div>
        ))}
      </div>
    );
  }

  // Empty state
  if (items.length === 0 && !isLoading) {
    return (
      <EmptyState
        icon={Calendar}
        title="No recommendations yet"
        description="Set up subscriptions to start discovering artists"
        action={{ label: 'Set Up Subscriptions', onClick: () => router.push('/subscriptions') }}
      />
    );
  }

  const uniqueItems = [...new Map(items.map(item => [item.id, item])).values()];
  return (
    <div>
      <p role="status" aria-live="polite" className="py-2 font-mono text-xs text-muted-foreground">{uniqueItems.length} artists loaded{hasMore ? ' · more available' : ''}</p>
      <div
        data-testid="feed-grid"
        data-view={view}
        className={view === 'artwork' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'border-t'}
      >
        {uniqueItems.map(item => (
          <FeedCard
            key={item.id}
            id={item.id}
            artistName={item.artistName}
            artistMbid={item.artistMbid}
            acquisitionState={item.acquisitionState}
            acquisitionMessage={item.acquisitionMessage}
            sourceRecords={item.sourceRecords}
            sourceRecordCount={item.sourceRecordCount}
            view={view}
            onOpen={onOpen}
            imageUrl={item.imageUrl}
            status={item.status ?? (item.acquisitionState === 'adding' ? 'adding' : item.acquisitionState === 'failed' || item.acquisitionState === 'uncertain' ? 'failed' : 'pending')}
            isLoading={loadingIds.has(item.id)}
            onApprove={onApprove}
            onDismiss={onDismiss}
            tags={item.tags}
            listeners={item.listeners}
            subscriptionName={item.subscriptionName}
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div ref={sentinelRef} className="mt-4">
          <Button variant="outline" disabled={isLoading} onClick={onLoadMore}>Load more</Button>
          {isLoading && (
            <div data-testid="loading-spinner" className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
