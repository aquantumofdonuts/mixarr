'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, Tab } from '@/components/ui';
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

interface Subscription {
  id: number;
  name: string;
  type: string;
  config: Record<string, any>;
  schedule: string | null;
  resultHandling: string;
  isActive: boolean;
  lastRun: string | null;
}

interface SubscriptionRun {
  id: number;
  status: string;
  resultsCount: number;
  addedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface SubscriptionResult {
  id: number;
  itemType: string;
  name: string;
  artistName: string | null;
  mbid: string | null;
  status: string;
  skipReason: string | null;
  createdAt: string;
  imageUrl?: string;
}

export default function SubscriptionDetailPage() {
  const params = useParams();
  const subscriptionId = parseInt(params.id as string, 10);
  
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [runs, setRuns] = useState<SubscriptionRun[]>([]);
  const [results, setResults] = useState<SubscriptionResult[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null);
  const [processingResultId, setProcessingResultId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'runs' | 'results'>('runs');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { addToast } = useToast();

  const fetchSubscription = async () => {
    const { data, error } = await api.get<{ subscription: Subscription }>(`/api/subscriptions/${subscriptionId}`);
    if (data) setSubscription(data.subscription);
    if (error) addToast({ type: 'error', title: 'Failed to load subscription' });
  };

  const fetchRuns = async () => {
    const { data } = await api.get<{ runs: SubscriptionRun[] }>(`/api/subscriptions/${subscriptionId}/runs`);
    if (data) setRuns(data.runs);
  };

  const fetchResults = async () => {
    const params = statusFilter ? `?status=${statusFilter}` : '';
    const { data } = await api.get<{ results: SubscriptionResult[]; statusCounts: Record<string, number> }>(
      `/api/subscriptions/${subscriptionId}/results${params}`
    );
    if (data) {
      setResults(data.results);
      setStatusCounts(data.statusCounts);
    }
  };

  const fetchRunDetails = async (runId: number) => {
    setLoadingRunId(runId);
    const { data } = await api.get<{ run: SubscriptionRun; results: SubscriptionResult[] }>(
      `/api/subscriptions/${subscriptionId}/runs/${runId}`
    );
    if (data) {
      setResults(data.results);
      setSelectedRun(runId);
    }
    setLoadingRunId(null);
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await fetchSubscription();
      await fetchRuns();
      await fetchResults();
      setIsLoading(false);
    };
    loadData();
  }, [subscriptionId]);

  useEffect(() => {
    if (activeTab === 'results' && selectedRun === null) {
      fetchResults();
    }
  }, [statusFilter, activeTab]);

  const handleApprove = async (resultId: number) => {
    setProcessingResultId(resultId);
    const { error } = await api.post(`/api/subscriptions/${subscriptionId}/results/${resultId}/approve`);
    if (error) {
      addToast({ type: 'error', title: 'Failed to approve' });
    } else {
      addToast({ type: 'success', title: 'Artist approved' });
      fetchResults();
    }
    setProcessingResultId(null);
  };

  const handleReject = async (resultId: number) => {
    setProcessingResultId(resultId);
    const { error } = await api.post(`/api/subscriptions/${subscriptionId}/results/${resultId}/reject`);
    if (error) {
      addToast({ type: 'error', title: 'Failed to reject' });
    } else {
      addToast({ type: 'success', title: 'Artist rejected' });
      fetchResults();
    }
    setProcessingResultId(null);
  };

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
      case 'completed': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running': return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getResultStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-500',
      queued: 'bg-blue-500/20 text-blue-500',
      added: 'bg-green-500/20 text-green-500',
      skipped: 'bg-gray-500/20 text-gray-500',
      failed: 'bg-red-500/20 text-red-500',
      rejected: 'bg-red-500/20 text-red-500',
    };
    return <Badge className={colors[status] || 'bg-gray-500/20'}>{status}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="h-12 w-12 text-primary animate-spin" />
        <p className="text-muted-foreground">Loading subscription data...</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={subscription?.name || 'Subscription'}
        description={`Type: ${subscription?.type} | Result handling: ${subscription?.resultHandling}`}
      >
        <div className="flex gap-2">
          <Link href="/subscriptions">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
          </Link>
          <Button onClick={handleRun}>
            <Play className="h-4 w-4 mr-2" /> Run Now
          </Button>
        </div>
      </PageHeader>

      {/* Tabs */}
      <Tabs value={activeTab} onChange={(v) => { setActiveTab(v as 'runs' | 'results'); setSelectedRun(null); }} className="mb-6">
        <Tab value="runs" label="Run History" badge={runs.length} />
        <Tab value="results" label="All Results" badge={Object.values(statusCounts).reduce((a, b) => a + b, 0)} />
      </Tabs>

      {activeTab === 'runs' && !selectedRun && (
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
                className={`cursor-pointer hover:bg-muted/50 transition-colors ${loadingRunId === run.id ? 'opacity-70' : ''}`} 
                onClick={() => !loadingRunId && fetchRunDetails(run.id)}
              >
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4">
                    {loadingRunId === run.id ? (
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
                    {loadingRunId === run.id && (
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
      )}

      {(activeTab === 'results' || selectedRun) && (
        <div className="space-y-4">
          {selectedRun && (
            <Button variant="outline" onClick={() => { setSelectedRun(null); setStatusFilter(''); }}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to runs
            </Button>
          )}

          {/* Status filter - show for both All Results and Run Details */}
          {(() => {
            // Calculate counts from current results
            const counts = results.reduce((acc, r) => {
              acc[r.status] = (acc[r.status] || 0) + 1;
              return acc;
            }, {} as Record<string, number>);
            const total = results.length;
            
            return (
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant={statusFilter === '' ? 'default' : 'outline'}
                  onClick={() => setStatusFilter('')}
                >
                  All ({total})
                </Button>
                {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
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
            );
          })()}

          {(() => {
            // Filter results by status
            const filteredResults = statusFilter 
              ? results.filter(r => r.status === statusFilter)
              : results;
            
            return filteredResults.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  {statusFilter ? `No ${statusFilter} results found` : 'No results found'}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {filteredResults.map((result) => (
                <Card key={result.id}>
                  <CardContent className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-md overflow-hidden bg-muted">
                        {result.imageUrl ? (
                          <img
                            src={result.imageUrl}
                            alt={result.name}
                            className="w-full h-full object-cover"
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
                            disabled={processingResultId === result.id}
                          >
                            {processingResultId === result.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            )}
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => handleReject(result.id)}
                            disabled={processingResultId === result.id}
                          >
                            <XCircle className="h-4 w-4 text-red-500" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          );
          })()}
        </div>
      )}
    </>
  );
}
