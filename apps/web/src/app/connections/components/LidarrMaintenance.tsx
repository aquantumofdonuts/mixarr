'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Library from 'lucide-react/dist/esm/icons/library';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LidarrStats {
  total: number;
  needingRefresh: number;
  issueStats: {
    noAlbums: number;
    noPoster: number;
    noOverview: number;
    noGenres: number;
  };
}

export interface LidarrMaintenanceProps {
  connectionId: number;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const lidarrMaintenanceKeys = {
  stats: (connectionId: number) =>
    ['connections', connectionId, 'lidarr-maintenance'] as const,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LidarrMaintenance({ connectionId }: LidarrMaintenanceProps) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Clear pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Fetch library stats on mount
  const statsQuery = useQuery({
    queryKey: lidarrMaintenanceKeys.stats(connectionId),
    queryFn: async () => {
      const { data, error } = await api.get<LidarrStats>(
        '/api/search/lidarr/artists',
      );
      if (error) throw new Error(error);
      return data!;
    },
  });

  // Refresh artists by issue type
  const refreshMutation = useMutation({
    mutationFn: async (issueType: string) => {
      const { data, error } = await api.post<{
        success: boolean;
        refreshed: number;
        message: string;
      }>('/api/search/lidarr/artists/refresh-by-issue', {
        issueType,
        limit: 50,
      });
      if (error) throw new Error(error);
      return data!;
    },
    onSuccess: (data) => {
      addToast({
        type: 'success',
        title: 'Refresh started',
        message: data.message,
      });
      // Allow Lidarr time to process before re-fetching stats
      timerRef.current = setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: lidarrMaintenanceKeys.stats(connectionId),
        });
      }, 5000);
    },
  });

  const stats = statsQuery.data;
  const isRefreshing = refreshMutation.isPending;

  return (
    <div className="border-t pt-2 mt-2 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Library Maintenance
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => statsQuery.refetch()}
          disabled={statsQuery.isFetching}
          className="h-6 px-2"
        >
          <RefreshCw
            className={`h-3 w-3 ${statsQuery.isFetching ? 'animate-spin' : ''}`}
          />
        </Button>
      </div>

      {/* Error states */}
      {statsQuery.error && (
        <p role="alert" className="text-xs text-destructive">
          {statsQuery.error instanceof Error
            ? statsQuery.error.message
            : 'An error occurred'}
        </p>
      )}

      {refreshMutation.error && (
        <p role="alert" className="text-xs text-destructive">
          {refreshMutation.error instanceof Error
            ? refreshMutation.error.message
            : 'Refresh failed'}
        </p>
      )}

      {/* Loading state (initial fetch only) */}
      {statsQuery.isLoading && (
        <div role="status" className="flex items-center justify-center py-2">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading library stats</span>
        </div>
      )}

      {/* Stats display */}
      {stats && (
        <div className="text-xs space-y-2">
          {/* Total artists */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Library className="h-3 w-3" />
              Total Artists
            </span>
            <span className="font-medium">{stats.total}</span>
          </div>

          {/* Issue breakdown */}
          {stats.issueStats && (
            <div className="border rounded-md p-2 space-y-1 bg-muted/50">
              <div className="flex items-center justify-between">
                <span>No Albums</span>
                <span
                  className={
                    stats.issueStats.noAlbums > 0
                      ? 'text-yellow-500 font-medium'
                      : 'text-green-500'
                  }
                >
                  {stats.issueStats.noAlbums}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>No Poster</span>
                <span
                  className={
                    stats.issueStats.noPoster > 0
                      ? 'text-yellow-500 font-medium'
                      : 'text-green-500'
                  }
                >
                  {stats.issueStats.noPoster}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>No Bio</span>
                <span
                  className={
                    stats.issueStats.noOverview > 0
                      ? 'text-yellow-500 font-medium'
                      : 'text-green-500'
                  }
                >
                  {stats.issueStats.noOverview}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>No Genres</span>
                <span
                  className={
                    stats.issueStats.noGenres > 0
                      ? 'text-yellow-500 font-medium'
                      : 'text-green-500'
                  }
                >
                  {stats.issueStats.noGenres}
                </span>
              </div>
            </div>
          )}

          {/* Refresh buttons */}
          {stats.needingRefresh > 0 && (
            <div className="space-y-1 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => refreshMutation.mutate('any')}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={`h-3 w-3 mr-1 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                {isRefreshing
                  ? 'Refreshing...'
                  : 'Refresh All Issues (up to 50)'}
              </Button>
              {stats.issueStats?.noAlbums > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full text-xs"
                  onClick={() => refreshMutation.mutate('no_albums')}
                  disabled={isRefreshing}
                >
                  Refresh {stats.issueStats.noAlbums} with No Albums
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
