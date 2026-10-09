'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { ResultState } from '@/components/ui/result-state';
import { api } from '@/lib/api';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import { useAuth } from '@/lib/auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface Job {
  id: string;
  state: 'completed' | 'failed' | 'active' | 'waiting' | 'delayed' | 'paused';
  data: {
    subscriptionId?: number;
    importSourceId?: number;
    userId?: number;
    subscriptionName?: string;
    importSourceName?: string;
  };
  user?: { id: number; username: string; displayName: string | null } | null;
  progress?: number;
  timestamp?: number;
  finishedOn?: number;
  failedReason?: string;
  returnvalue?: {
    success?: boolean;
    artistsFound?: number;
    artistsAdded?: number;
    error?: string;
  };
}

const queueNames = [
  { value: 'subscription', label: 'Subscription Jobs' },
  { value: 'import', label: 'Import Jobs' },
];

function getJobStatus(job: Job): 'completed' | 'failed' | 'active' | 'waiting' {
  if (job.state === 'failed') return 'failed';
  if (job.state === 'completed') return 'completed';
  if (job.state === 'active') return 'active';
  return 'waiting';
}

function JobStatusBadge({ status }: { status: ReturnType<typeof getJobStatus> }) {
  switch (status) {
    case 'completed':
      return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
    case 'failed':
      return <Badge variant="error"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    case 'active':
      return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
    case 'waiting':
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Waiting</Badge>;
  }
}

function formatDuration(start?: number, end?: number): string {
  if (!start || !end) return '-';
  const duration = end - start;
  if (duration < 1000) return `${duration}ms`;
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
  return `${(duration / 60000).toFixed(1)}m`;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

export default function JobsPage() {
  const { user: currentUser } = useAuth();
  const [activeQueue, setActiveQueue] = useState('subscription');
  const queryClient = useQueryClient();

  // React Query for jobs with auto-refresh
  const { data: jobs = [], isLoading, isFetching: isRefreshing, isError, error } = useQuery({
    queryKey: ['jobs', activeQueue],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.get<{ jobs: Job[] }>(`/api/jobs/recent/${activeQueue}?limit=50`, { signal });
      if (error) throw new Error(error);
      return data!.jobs;
    },
    staleTime: 5 * 1000, // Consider fresh for 5 seconds
    refetchInterval: (query) => {
      // Auto-refresh every 5 seconds if there are active jobs
      const jobs = query.state.data || [];
      const hasActiveJobs = jobs.some(j => j.state === 'active' || j.state === 'waiting');
      return hasActiveJobs ? 5000 : false;
    },
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['jobs', activeQueue] });
  };

  const activeJobs = jobs.filter(j => getJobStatus(j) === 'active' || getJobStatus(j) === 'waiting');
  const completedJobs = jobs.filter(j => getJobStatus(j) === 'completed');
  const failedJobs = jobs.filter(j => getJobStatus(j) === 'failed');

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Monitor background job processing"
      >
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </PageHeader>

      {/* Queue Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {queueNames.map((queue) => (
          <Button
            key={queue.value}
            variant={activeQueue === queue.value ? 'default' : 'outline'}
            aria-pressed={activeQueue === queue.value}
            onClick={() => setActiveQueue(queue.value)}
          >
            {queue.label}
          </Button>
        ))}
      </div>

      {!isLoading && !isError && <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-2 border-y py-3 text-sm">
        {([['Active', activeJobs.length], ['Completed', completedJobs.length], ['Failed', failedJobs.length]] as const).map(([label, count]) => (
          <div key={label} className="flex gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono font-semibold">{count}</dd></div>
        ))}
      </dl>}

      {/* Jobs List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Jobs</CardTitle>
          <CardDescription>
            Last <span className="font-mono">50</span> jobs from the {activeQueue} queue
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-container border bg-card">
                  <Skeleton className="w-8 h-8 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <ResultState kind="error" message={error.message} action={<Button variant="outline" onClick={handleRefresh}>Retry</Button>} />
          ) : jobs.length === 0 ? (
            <ResultState kind="no-records" message={`No recent jobs in the ${activeQueue} queue.`} />
          ) : (
            <div className="divide-y border-y">
              {jobs.map((job) => {
                const status = getJobStatus(job);
                return (
                  <div
                    key={job.id}
                    className="flex min-w-0 items-center justify-between py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-3">
                        <JobStatusBadge status={status} />
                        <span className="min-w-0 break-words font-medium">
                          {job.data.subscriptionName || job.data.importSourceName || `Job ${job.id.slice(0, 8)}`}
                        </span>
                        {/* Owners remain visible only to admins. */}
                        {currentUser?.role === 'admin' && job.user && job.data.userId !== currentUser.id && (
                          <span className="text-xs text-muted-foreground">Owner: {job.user.displayName || job.user.username}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                        <span>Job {job.id} · Started: {formatTime(job.timestamp)}</span>
                        <span>Duration: {formatDuration(job.timestamp, job.finishedOn)}</span>
                      </div>
                      {status === 'completed' && job.returnvalue && (
                        <div className="text-sm mt-1">
                          {job.returnvalue.artistsFound !== undefined && (
                            <span className="font-mono">
                              Found: {job.returnvalue.artistsFound}, Added: {job.returnvalue.artistsAdded || 0}
                            </span>
                          )}
                        </div>
                      )}
                      {status === 'failed' && job.failedReason && (
                        <p className="text-sm text-status-error mt-1">
                          {job.failedReason}
                        </p>
                      )}
                      {status === 'active' && job.progress !== undefined && (
                        <div className="mt-2">
                          <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${job.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
