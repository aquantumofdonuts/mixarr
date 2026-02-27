'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import PlayCircle from 'lucide-react/dist/esm/icons/play-circle';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import User from 'lucide-react/dist/esm/icons/user';
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
      return <Badge variant="default" className="bg-status-success"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
    case 'failed':
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    case 'active':
      return <Badge variant="default" className="bg-status-info"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
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
  const { data: jobs = [], isLoading, isFetching: isRefreshing } = useQuery({
    queryKey: ['jobs', activeQueue],
    queryFn: async () => {
      const { data, error } = await api.get<{ jobs: Job[] }>(`/api/jobs/recent/${activeQueue}?limit=50`);
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
      <div className="flex gap-2 mb-6">
        {queueNames.map((queue) => (
          <Button
            key={queue.value}
            variant={activeQueue === queue.value ? 'default' : 'outline'}
            onClick={() => setActiveQueue(queue.value)}
          >
            {queue.label}
          </Button>
        ))}
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-status-info" />
              <span className="text-2xl font-bold">{activeJobs.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-status-success" />
              <span className="text-2xl font-bold">{completedJobs.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-status-error" />
              <span className="text-2xl font-bold">{failedJobs.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Jobs</CardTitle>
          <CardDescription>
            Last 50 jobs from the {activeQueue} queue
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No jobs found</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => {
                const status = getJobStatus(job);
                return (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <JobStatusBadge status={status} />
                        <span className="font-medium">
                          {job.data.subscriptionName || job.data.importSourceName || `Job ${job.id.slice(0, 8)}`}
                        </span>
                        {/* Show owner badge for admins */}
                        {currentUser?.role === 'admin' && job.user && job.data.userId !== currentUser.id && (
                          <Badge variant="outline" className="text-xs">
                            <User className="h-3 w-3 mr-1" />
                            {job.user.displayName || job.user.username}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground flex gap-4">
                        <span>Started: {formatTime(job.timestamp)}</span>
                        <span>Duration: {formatDuration(job.timestamp, job.finishedOn)}</span>
                      </div>
                      {status === 'completed' && job.returnvalue && (
                        <div className="text-sm mt-1">
                          {job.returnvalue.artistsFound !== undefined && (
                            <span className="text-status-success">
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
