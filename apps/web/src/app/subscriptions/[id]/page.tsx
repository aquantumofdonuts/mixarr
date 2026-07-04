'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, Tab, TabPanel, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Music2 from 'lucide-react/dist/esm/icons/music-2';
import Play from 'lucide-react/dist/esm/icons/play';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ExternalLinks } from '@/components/ExternalLinks';
import { subscriptionTypes } from '@/lib/subscription-constants';
import { buildSubscriptionDescriptor, isDefaultName } from '@/lib/subscription-descriptor';
import {
  useSubscriptionDetail,
  useSubscriptionRuns,
  useSubscriptionResults,
  useSubscriptionRunDetails,
  useApproveResult,
  useRejectResult,
  RESULTS_PAGE_SIZE,
} from '@/lib/hooks';

export default function SubscriptionDetailPage() {
  const params = useParams();
  const subscriptionId = parseInt(params.id as string, 10);
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<'runs' | 'results'>('runs');
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(0);

  // These three fire in parallel — no waterfall.
  const { data: subscription, isLoading: subLoading, isError: subError } = useSubscriptionDetail(subscriptionId);
  const { data: runs = [], isLoading: runsLoading } = useSubscriptionRuns(subscriptionId);
  const { data: resultsPage, isLoading: resultsLoading, isFetching: resultsFetching } =
    useSubscriptionResults(subscriptionId, statusFilter, page);
  const { data: runDetails, isLoading: runDetailsLoading } =
    useSubscriptionRunDetails(subscriptionId, selectedRun);

  const approveMutation = useApproveResult(subscriptionId);
  const rejectMutation = useRejectResult(subscriptionId);

  const isLoading = subLoading || runsLoading || resultsLoading;

  // Show error toast once when the subscription fails to load
  useEffect(() => {
    if (subError) addToast({ type: 'error', title: 'Failed to load subscription' });
  }, [subError]);

  // Filter changes reset paging
  const handleFilterChange = (s: string) => { setStatusFilter(s); setPage(0); };

  const handleApprove = (resultId: number) =>
    approveMutation.mutate(resultId, {
      onSuccess: () => addToast({ type: 'success', title: 'Artist approved' }),
      onError: () => addToast({ type: 'error', title: 'Failed to approve' }),
    });

  const handleReject = (resultId: number) =>
    rejectMutation.mutate(resultId, {
      onSuccess: () => addToast({ type: 'success', title: 'Artist rejected' }),
      onError: () => addToast({ type: 'error', title: 'Failed to reject' }),
    });

  const handleRun = async () => {
    const { error } = await api.post(`/api/jobs/run/subscription/${subscriptionId}`);
    if (error) {
      addToast({ type: 'error', title: 'Failed to start subscription' });
    } else {
      addToast({ type: 'success', title: 'Subscription started' });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4 text-status-success" />;
      case 'failed': return <XCircle className="h-4 w-4 text-status-error" />;
      case 'running': return <RefreshCw className="h-4 w-4 text-status-info animate-spin" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getResultStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-status-warning/20 text-status-warning',
      queued: 'bg-status-info/20 text-status-info',
      added: 'bg-status-success/20 text-status-success',
      skipped: 'bg-muted-foreground/20 text-muted-foreground',
      failed: 'bg-status-error/20 text-status-error',
      rejected: 'bg-status-error/20 text-status-error',
    };
    return <Badge className={colors[status] || 'bg-muted-foreground/20'}>{status}</Badge>;
  };

  // Subscription-wide counts from server (cover ALL pages, not just current)
  const statusCounts = resultsPage?.statusCounts ?? {};
  const totalCount = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  // Pagination for the all-results view
  const totalForFilter = resultsPage?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalForFilter / RESULTS_PAGE_SIZE));

  const renderResultCard = (result: NonNullable<typeof resultsPage>['results'][number]) => {
    const approvePending = approveMutation.isPending && approveMutation.variables === result.id;
    const rejectPending = rejectMutation.isPending && rejectMutation.variables === result.id;
    return (
      <Card key={result.id}>
        <CardContent className="flex items-center justify-between py-3">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-md overflow-hidden bg-muted">
              {result.imageUrl ? (
                <img
                  src={result.imageUrl}
                  alt={result.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Music2 className="h-6 w-6 sm:h-7 sm:w-7 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{result.name}</p>
              {result.skipReason && (
                <p className="text-xs text-muted-foreground">{result.skipReason}</p>
              )}
              <ExternalLinks mbid={result.mbid || undefined} artistName={result.name} size="sm" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getResultStatusBadge(result.status)}
            {(result.status === 'pending' || result.status === 'queued') && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleApprove(result.id)}
                  disabled={approvePending || rejectPending}
                >
                  {approvePending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-status-success" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleReject(result.id)}
                  disabled={approvePending || rejectPending}
                >
                  {rejectPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4 text-status-error" />
                  )}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderAllResultsContent = () => (
    <>
      {/* Subscription-wide status filter buttons — counts cover all pages */}
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant={statusFilter === '' ? 'default' : 'outline'}
          onClick={() => handleFilterChange('')}
        >
          All ({totalCount})
        </Button>
        {Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
          <Button
            key={status}
            size="sm"
            variant={statusFilter === status ? 'default' : 'outline'}
            onClick={() => handleFilterChange(status)}
          >
            {status} ({count})
          </Button>
        ))}
      </div>

      {resultsLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-container" />)}
        </div>
      ) : !resultsPage?.results.length ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {statusFilter ? `No ${statusFilter} results found` : 'No results found'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {resultsPage.results.map(renderResultCard)}
        </div>
      )}

      {/* Pagination controls */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {pageCount}{resultsFetching ? ' · updating…' : ''}
          </span>
          <Button size="sm" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </>
  );

  const renderRunDetailsContent = () => {
    if (runDetailsLoading) {
      return (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-container" />)}
        </div>
      );
    }

    const runResults = runDetails?.results ?? [];

    // Client-side filter for run-details view (small, unpaginated payload)
    const runCounts = runResults.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const runTotal = runResults.length;
    const filteredRunResults = statusFilter ? runResults.filter(r => r.status === statusFilter) : runResults;

    return (
      <>
        <Button variant="outline" onClick={() => { setSelectedRun(null); setStatusFilter(''); }}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to runs
        </Button>

        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant={statusFilter === '' ? 'default' : 'outline'} onClick={() => setStatusFilter('')}>
            All ({runTotal})
          </Button>
          {Object.entries(runCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
            <Button
              key={status}
              size="sm"
              variant={statusFilter === status ? 'default' : 'outline'}
              onClick={() => setStatusFilter(status)}
            >
              {status} ({count})
            </Button>
          ))}
        </div>

        {filteredRunResults.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {statusFilter ? `No ${statusFilter} results found` : 'No results found'}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredRunResults.map(renderResultCard)}
          </div>
        )}
      </>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="w-16 h-16 rounded-container" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="flex gap-4 border-b pb-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-container" />
          ))}
        </div>
      </div>
    );
  }

  const typeLabel = subscriptionTypes.find(t => t.value === subscription?.type)?.label || subscription?.type || '';
  const descriptor = subscription
    ? buildSubscriptionDescriptor(subscription.type, subscription.config, typeLabel)
    : 'Subscription';
  const showCustomName = subscription?.name && !isDefaultName(subscription.name, typeLabel, descriptor);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li><Link href="/subscriptions" className="hover:text-foreground transition-colors">Subscriptions</Link></li>
          <li className="text-muted-foreground/50">/</li>
          <li className="text-foreground font-medium truncate">{descriptor || 'Loading...'}</li>
        </ol>
      </nav>
      <PageHeader
        title={descriptor}
        description={showCustomName
          ? `${subscription.name} · Type: ${typeLabel} | Result handling: ${subscription?.resultHandling}`
          : `Type: ${typeLabel} | Result handling: ${subscription?.resultHandling}`
        }
      >
        <Button onClick={handleRun}>
          <Play className="h-4 w-4 mr-2" /> Run Now
        </Button>
      </PageHeader>

      <Tabs value={activeTab} onChange={(v) => { setActiveTab(v as 'runs' | 'results'); setSelectedRun(null); setStatusFilter(''); setPage(0); }} className="mb-6">
        <Tab value="runs" label="Run History" badge={runs.length} />
        <Tab value="results" label="All Results" badge={totalCount} />
        <TabPanel value="runs">
          {!selectedRun ? (
            <div className="space-y-4">
              {runs.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No runs yet. Click &quot;Run Now&quot; to start.
                  </CardContent>
                </Card>
              ) : (
                runs.map((run) => (
                  <Card
                    key={run.id}
                    className={`cursor-pointer hover:bg-muted/50 transition-colors ${runDetailsLoading && selectedRun === run.id ? 'opacity-70' : ''}`}
                    onClick={() => { setSelectedRun(run.id); setStatusFilter(''); }}
                  >
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-4">
                        {runDetailsLoading && selectedRun === run.id ? (
                          <Loader2 className="h-4 w-4 text-primary animate-spin" />
                        ) : (
                          getStatusIcon(run.status)
                        )}
                        <div>
                          <p className="font-medium">
                            {new Date(run.startedAt).toLocaleString()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {run.status === 'completed'
                              ? `Found ${run.resultsCount} artists • Added ${run.addedCount} • Skipped ${run.skippedCount}`
                              : run.errorMessage || run.status}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {runDetailsLoading && selectedRun === run.id && (
                          <span className="text-sm text-muted-foreground">Loading...</span>
                        )}
                        <Badge variant={run.status === 'completed' ? 'default' : 'destructive'}>
                          {run.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {renderRunDetailsContent()}
            </div>
          )}
        </TabPanel>
        <TabPanel value="results">
          <div className="space-y-4">
            {renderAllResultsContent()}
          </div>
        </TabPanel>
      </Tabs>
    </>
  );
}
