'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { useLogs } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Bug from 'lucide-react/dist/esm/icons/bug';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Filter from 'lucide-react/dist/esm/icons/filter';
import Info from 'lucide-react/dist/esm/icons/info';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';

const levelConfig = {
  debug: { icon: Bug, color: 'text-muted-foreground', bg: 'bg-muted' },
  info: { icon: Info, color: 'text-status-info', bg: 'bg-status-info/10' },
  warn: { icon: AlertTriangle, color: 'text-status-warning', bg: 'bg-status-warning/10' },
  error: { icon: AlertCircle, color: 'text-status-error', bg: 'bg-status-error/10' },
};

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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  // React Query for logs with caching
  const { data, isFetching } = useLogs({ 
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
        description={total > 0 ? <span className="tabular-nums">{total.toLocaleString()} total entries</span> : 'View application activity and errors'}
      >
        <Button variant="outline" onClick={handleRefresh} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex flex-wrap gap-4">
            <div className="w-40">
              <Select
                value={level}
                onChange={(e) => handleFilterChange(e.target.value, category)}
                options={levelOptions}
              />
            </div>
            <div className="w-40">
              <Select
                value={category}
                onChange={(e) => handleFilterChange(level, e.target.value)}
                options={categoryOptions}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Input
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
      {logs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No logs found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {level || category || search ? 'Try adjusting your filters' : 'Logs will appear here as events occur'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {logs.map((log) => {
                const config = levelConfig[log.level];
                const LevelIcon = config.icon;
                const isExpanded = expandedId === log.id;

                return (
                  <div
                    key={log.id}
                    className="p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`rounded-lg p-2 ${config.bg} ${config.color}`}>
                        <LevelIcon className="h-4 w-4" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="uppercase text-xs">
                            {log.level}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {log.category}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(log.createdAt)}
                          </span>
                        </div>
                        
                        <p className={`mt-1 ${isExpanded ? '' : 'truncate'}`}>
                          {log.message}
                        </p>

                        {isExpanded && log.metadata && (
                          <pre className="mt-3 p-3 rounded-lg bg-muted text-xs overflow-x-auto">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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
                    <ChevronDown className="h-4 w-4 mr-2" />
                  )}
                  Load More (<span className="tabular-nums">{logs.length} of {total.toLocaleString()}</span>)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
