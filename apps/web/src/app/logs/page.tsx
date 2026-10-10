'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui';
import { ResultState } from '@/components/ui/result-state';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { useLogs } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Filter from 'lucide-react/dist/esm/icons/filter';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';

const levelOptions = [
  { value: '', label: 'All levels' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

const categoryOptions = [
  { value: '', label: 'All categories' },
  { value: 'auth', label: 'Authentication' },
  { value: 'subscription', label: 'Subscriptions' },
  { value: 'import', label: 'Imports' },
  { value: 'lidarr', label: 'Lidarr' },
  { value: 'spotify', label: 'Spotify' },
  { value: 'lastfm', label: 'Last.fm' },
  { value: 'system', label: 'System' },
];

const PAGE_SIZE = 100;

export default function LogsPage() {
  const queryClient = useQueryClient();
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);

  // React Query for logs with caching
  const { data, isFetching, isLoading, isError, error } = useLogs({
    level,
    category,
    search,
    limit: PAGE_SIZE,
    offset
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const hasMore = data?.hasMore || false;

  const handleRefresh = () => {
    setOffset(0);
    queryClient.invalidateQueries({ queryKey: ['logs'] });
  };

  const loadMore = () => {
    setOffset(prev => prev + PAGE_SIZE);
  };

  const handleFilterChange = (newLevel: string, newCategory: string) => {
    setLevel(newLevel);
    setCategory(newCategory);
    setOffset(0); // Reset pagination on filter change
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setOffset(0); // Reset pagination on search
  };

  const formatTime = (date: string) => {
    return new Date(date).toLocaleString();
  };

  return (
    <>
      <PageHeader
        title="Logs"
        description={total > 0 ? <span className="font-mono tabular-nums">{total.toLocaleString()} total entries</span> : 'View application activity and errors'}
      >
        <Button variant="outline" onClick={handleRefresh} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Select
                label="Level"
                value={level}
                onChange={(e) => handleFilterChange(e.target.value, category)}
                options={levelOptions}
              />
            </div>
            <div className="w-40">
              <Select
                label="Category"
                value={category}
                onChange={(e) => handleFilterChange(level, e.target.value)}
                options={categoryOptions}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Input
                label="Search logs"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search logs..."
              />
            </div>
            <Button type="submit">
              <Filter className="h-4 w-4 mr-2" /> Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Logs List */}
      {isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="space-y-1 p-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-12 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : isError ? (
        <ResultState kind="error" message={error.message} action={<Button variant="outline" onClick={handleRefresh}>Retry</Button>} />
      ) : logs.length === 0 ? (
        <ResultState kind={level || category || search ? 'no-matches' : 'no-records'} message={level || category || search ? 'Try adjusting your filters.' : 'Logs will appear here as events occur.'} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {logs.map((log) => (
                <details key={log.id} className="group min-w-0">
                  <summary className="flex cursor-pointer list-none items-start gap-3 px-3 py-3 hover:bg-muted [&::-webkit-details-marker]:hidden">
                    <ChevronRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 transition-transform duration-[140ms] group-open:rotate-90" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
                        <span className={log.level === 'error' ? 'text-status-error' : log.level === 'warn' ? 'text-status-warning' : ''}>{log.level.toUpperCase()}</span>
                        <span>{log.category}</span><span>{formatTime(log.createdAt)}</span><span>#{log.id}</span>
                      </span>
                      <span className="mt-1 block break-words">{log.message}</span>
                    </span>
                  </summary>
                  <div className="px-3 pb-3 sm:pl-10">
                    {log.metadata ? <pre className="overflow-x-auto rounded-button bg-muted p-3 font-mono text-xs">{JSON.stringify(log.metadata, null, 2)}</pre> : <p className="text-sm text-muted-foreground">No additional details recorded.</p>}
                  </div>
                </details>
              ))}
            </div>

            {/* Load More Button */}
            {hasMore && (
              <div className="p-4 border-t flex justify-center">
                <Button
                  variant="outline"
                  onClick={loadMore}
                  disabled={isFetching}
                >
                  {isFetching ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ChevronRight className="h-4 w-4 mr-2 rotate-90" />
                  )}
                  Load More (<span className="font-mono tabular-nums">{logs.length} of {total.toLocaleString()}</span>)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
