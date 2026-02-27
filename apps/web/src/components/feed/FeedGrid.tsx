'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, Skeleton } from '@/components/ui';
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
}

export function FeedGrid({
  items,
  onApprove,
  onDismiss,
  onLoadMore,
  hasMore,
  isLoading = false,
  loadingIds = new Set(),
}: FeedGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    if (!hasMore || isLoading) return;

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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square">
            <Skeleton className="w-full h-full rounded-lg" />
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

  return (
    <div>
      {/* Grid */}
      <div
        data-testid="feed-grid"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
      >
        {items.map((item, i) => (
          <FeedCard
            key={item.id}
            id={item.id}
            artistName={item.artistName}
            imageUrl={item.imageUrl}
            status={item.status}
            isLoading={loadingIds.has(item.id)}
            onApprove={onApprove}
            onDismiss={onDismiss}
            tags={item.tags}
            listeners={item.listeners}
            subscriptionName={item.subscriptionName}
            index={i}
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div ref={sentinelRef} className="h-10 mt-4">
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
