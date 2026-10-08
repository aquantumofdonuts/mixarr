'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { DashboardTiles } from '@/components/feed/DashboardTiles';
import { StatsBar } from '@/components/feed/StatsBar';
import { FeedGrid } from '@/components/feed/FeedGrid';
import { Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useFeed, useApproveFeedItem, useDismissFeedItem } from '@/lib/hooks';

export default function Home() {
  const { addToast } = useToast();
  
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
    refetch,
  } = useFeed();

  const approveMutation = useApproveFeedItem();
  const dismissMutation = useDismissFeedItem();

  // Flatten pages into single items array
  const items = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.items);
  }, [data]);

  // Get stats from first page (they're the same across pages)
  const stats = data?.pages[0]?.stats ?? { pending: 0, addedToday: 0 };

  // Track which items have pending mutations
  const loadingIds = useMemo(() => {
    const ids = new Set<string>();
    if (approveMutation.isPending && approveMutation.variables) {
      ids.add(approveMutation.variables);
    }
    if (dismissMutation.isPending && dismissMutation.variables) {
      ids.add(dismissMutation.variables);
    }
    return ids;
  }, [approveMutation.isPending, approveMutation.variables, dismissMutation.isPending, dismissMutation.variables]);

  const handleApprove = async (id: string) => {
    // Find the item to get artist name for error message
    const item = items.find((i) => i.id === id);
    const artistName = item?.artistName || 'Artist';
    
    try {
      const result = await approveMutation.mutateAsync(id);
      const confirmed = result.outcome.state === 'added' || result.outcome.state === 'already-in-library';
      addToast({
        type: confirmed ? 'success' : 'error',
        title: result.outcome.state === 'already-in-library' ? 'Already in Lidarr' : confirmed ? 'Added to Lidarr' : 'Addition unconfirmed',
        message: result.outcome.message,
      });
    } catch {
      addToast({ 
        type: 'error', 
        title: 'Failed to Add', 
        message: `Could not add ${artistName}` 
      });
    }
  };

  const handleDismiss = async (id: string) => {
    // Find the item to get artist name for error message
    const item = items.find((i) => i.id === id);
    const artistName = item?.artistName || 'Artist';
    
    try {
      const result = await dismissMutation.mutateAsync(id);
      addToast({ 
        type: 'info', 
        title: 'Dismissed', 
        message: `${result.artistName} removed from feed` 
      });
    } catch {
      addToast({ 
        type: 'error', 
        title: 'Failed to Dismiss', 
        message: `Could not dismiss ${artistName}` 
      });
    }
  };

  const handleLoadMore = () => {
    if (!isFetchingNextPage && hasNextPage) {
      fetchNextPage();
    }
  };

  // Initial loading state (fixes DF-007)
  if (isLoading && items.length === 0) {
    return (
      <>
        <PageHeader title="Discovery Feed" description="Review and approve artist recommendations" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-container border bg-card overflow-hidden">
              <Skeleton className="aspect-square w-full" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Discovery Feed" description="Review and approve artist recommendations" />
        <div className="text-center py-16">
          <p className="text-destructive mb-4">Failed to load feed. Please try again.</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-container transition-colors"
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Discovery Feed" description="Review and approve artist recommendations" />
      <DashboardTiles />
      <StatsBar pending={stats.pending} addedToday={stats.addedToday} />
      <FeedGrid
        items={items}
        onApprove={handleApprove}
        onDismiss={handleDismiss}
        onLoadMore={handleLoadMore}
        hasMore={hasNextPage ?? false}
        isLoading={isFetchingNextPage}
        loadingIds={loadingIds}
      />
    </>
  );
}
