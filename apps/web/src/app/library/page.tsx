'use client';

import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Tabs, Tab, TabPanel, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { DuplicatesContent } from '@/components/library/duplicates-content';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import Copy from 'lucide-react/dist/esm/icons/copy';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Image from 'lucide-react/dist/esm/icons/image';
import Music from 'lucide-react/dist/esm/icons/music';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Search from 'lucide-react/dist/esm/icons/search';
import Wrench from 'lucide-react/dist/esm/icons/wrench';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';

interface FixJobStatus {
  jobId: string | null;
  status: 'running' | 'completed' | 'cancelled' | null;
  total: number;
  processed: number;
  fixed: number;
  failed: number;
  currentArtist?: string;
  startedAt?: string;
}

interface LidarrArtist {
  id: number;
  name: string;
  foreignArtistId: string;
  path?: string;
  monitored: boolean;
  albumCount: number;
  trackCount: number;
  trackFileCount: number;
  sizeOnDisk: number;
  hasOverview: boolean;
  hasPoster: boolean;
  hasGenres: boolean;
  issues: string[];
  needsRefresh: boolean;
}

interface IssueStats {
  noAlbums: number;
  noPoster: number;
  noOverview: number;
  noGenres: number;
}

type SortField = 'name' | 'albumCount' | 'issues';
type SortDirection = 'asc' | 'desc';
type FilterType = 'all' | 'needs_refresh' | 'no_albums' | 'no_poster' | 'no_overview' | 'no_genres' | 'complete';
type TabType = 'health' | 'duplicates';

export default function LibraryPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { addToast } = useToast();
  const isAdmin = user?.role === 'admin';

  const [artists, setArtists] = useState<LidarrArtist[]>([]);
  const [issueStats, setIssueStats] = useState<IssueStats | null>(null);
  const [healthScore, setHealthScore] = useState<number>(100);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortField, setSortField] = useState<SortField>('issues');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [activeTab, setActiveTab] = useState<TabType>('health');
  const [duplicateCount, setDuplicateCount] = useState<number>(0);
  const [fixJob, setFixJob] = useState<FixJobStatus | null>(null);
  const [isStartingFix, setIsStartingFix] = useState(false);
  const [isCancellingFix, setIsCancellingFix] = useState(false);
  const [fixingArtistId, setFixingArtistId] = useState<number | null>(null);
  const [confirmFixAll, setConfirmFixAll] = useState(false);

  const handleDuplicateCountChange = useCallback((count: number) => {
    setDuplicateCount(count);
  }, []);

  const JOB_COMPLETE_DISPLAY_MS = 3000;
  const POLL_INTERVAL_MS = 2000;

  // Guards the poll loop: skips a tick while the previous fetch is still
  // in flight, and ensures completion side effects (toast + refetch) fire
  // exactly once even if responses overlap.
  const pollInFlightRef = useRef(false);
  const completionHandledRef = useRef(false);

  // Check for existing fix job on mount
  useEffect(() => {
    if (!isAdmin) return;

    const checkJobStatus = async () => {
      const { data } = await api.get<FixJobStatus>('/api/search/lidarr/artists/fix-all/status');
      if (data) {
        setFixJob(data);
      }
    };

    checkJobStatus();
  }, [isAdmin]);

  // Poll when job is running, handle completion
  useEffect(() => {
    if (!fixJob || fixJob.status !== 'running') return;

    completionHandledRef.current = false;

    const pollStatus = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const { data } = await api.get<FixJobStatus>('/api/search/lidarr/artists/fix-all/status');
        if (data) {
          setFixJob(data);
          if ((data.status === 'completed' || data.status === 'cancelled') && !completionHandledRef.current) {
            completionHandledRef.current = true;
            fetchArtists();
            addToast({
              type: data.status === 'completed' ? 'success' : 'info',
              title: data.status === 'completed' ? 'Fix All Completed' : 'Fix All Cancelled',
              message: `Processed ${data.processed}/${data.total} artists. Fixed: ${data.fixed}, Failed: ${data.failed}`
            });
            setTimeout(() => setFixJob(null), JOB_COMPLETE_DISPLAY_MS);
          }
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const interval = setInterval(pollStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixJob?.status, fixJob?.jobId]);

  const handleFixAllClick = () => {
    const artistsWithIssues = artists.filter(a => a.needsRefresh).length;
    if (artistsWithIssues === 0) return;
    setConfirmFixAll(true);
  };

  const confirmFixAllAction = async () => {
    setConfirmFixAll(false);
    setIsStartingFix(true);
    const { data, error } = await api.post<{ jobId: string | null; total: number; message?: string }>('/api/search/lidarr/artists/fix-all');
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to start fix', message: error });
    } else if (data) {
      // API returns jobId: null if no artists need fixing
      if (!data.jobId || data.total === 0) {
        addToast({ type: 'info', title: 'No artists to fix', message: data.message || 'All artists already have complete metadata' });
      } else {
        setFixJob({
          jobId: data.jobId,
          status: 'running',
          total: data.total,
          processed: 0,
          fixed: 0,
          failed: 0
        });
        addToast({ type: 'success', title: 'Fix All Started', message: `Processing ${data.total} artists...` });
      }
    }
    setIsStartingFix(false);
  };

  const handleCancelFix = async () => {
    if (!fixJob?.jobId || isCancellingFix) return;
    
    setIsCancellingFix(true);
    const { error } = await api.post('/api/search/lidarr/artists/fix-all/cancel');
    setIsCancellingFix(false);
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to cancel', message: error });
    } else {
      addToast({ type: 'info', title: 'Cancelling...', message: 'Fix operation will stop after current artist' });
    }
  };

  const handleFixArtist = async (artistId: number) => {
    if (fixingArtistId !== null || fixJob?.status === 'running') return;
    
    setFixingArtistId(artistId);
    const { data, error } = await api.post<{
      success: boolean;
      artist: {
        id: number;
        name: string;
        hasPoster: boolean;
        hasOverview: boolean;
        hasGenres: boolean;
      };
      fixed: string[];
      stillMissing: string[];
    }>(`/api/search/lidarr/artists/${artistId}/fix`);
    
    if (error) {
      addToast({ type: 'error', title: 'Fix Failed', message: error });
    } else if (data) {
      if (data.success) {
        addToast({ 
          type: 'success', 
          title: 'Artist Fixed', 
          message: `${data.artist.name}: Metadata refreshed successfully` 
        });
        // Refresh the artist list to show updated status
        fetchArtists();
      } else {
        // Metadata still missing - likely stale SkyHook cache or missing upstream data
        const missingInfo = data.stillMissing.length > 0 
          ? `Missing: ${data.stillMissing.join(', ')} (may be unavailable upstream)`
          : 'Metadata unavailable in upstream sources';
        addToast({ 
          type: 'info', 
          title: 'No Changes', 
          message: `${data.artist.name}: ${missingInfo}` 
        });
        // Still refresh to show any partial updates
        fetchArtists();
      }
    }
    setFixingArtistId(null);
  };

  // Calculate artists needing fix
  const artistsNeedingFix = useMemo(() => {
    return artists.filter(a => a.needsRefresh).length;
  }, [artists]);

  // Redirect non-admin users
  useEffect(() => {
    if (!authLoading && user && !isAdmin) {
      router.replace('/');
    }
  }, [user, isAdmin, authLoading, router]);

  // Fetch artists on mount
  useEffect(() => {
    if (isAdmin) {
      fetchArtists();
    }
  }, [isAdmin]);

  const fetchArtists = async () => {
    setIsLoading(true);
    const { data, error } = await api.get<{
      artists: LidarrArtist[];
      total: number;
      needingRefresh: number;
      issueStats: IssueStats;
      healthScore: number;
    }>('/api/search/lidarr/artists');

    if (error) {
      addToast({ type: 'error', title: 'Failed to fetch library', message: error });
    } else if (data) {
      setArtists(data.artists);
      setIssueStats(data.issueStats);
      setHealthScore(data.healthScore);
    }
    setIsLoading(false);
  };

  // Defer search filtering so typing stays responsive on large libraries
  const deferredSearch = useDeferredValue(searchQuery);

  // Cap rendered rows; "Show more" reveals the rest incrementally
  const RENDER_CHUNK = 250;
  const [visibleCount, setVisibleCount] = useState(RENDER_CHUNK);

  // Filter and sort artists
  const filteredArtists = useMemo(() => {
    let result = [...artists];

    // Apply search filter
    if (deferredSearch) {
      const query = deferredSearch.toLowerCase();
      result = result.filter(a => a.name.toLowerCase().includes(query));
    }
    
    // Apply issue filter
    switch (filter) {
      case 'needs_refresh':
        result = result.filter(a => a.needsRefresh);
        break;
      case 'no_albums':
        result = result.filter(a => a.issues.includes('no_albums'));
        break;
      case 'no_poster':
        result = result.filter(a => a.issues.includes('no_poster'));
        break;
      case 'no_overview':
        result = result.filter(a => a.issues.includes('no_overview'));
        break;
      case 'no_genres':
        result = result.filter(a => a.issues.includes('no_genres'));
        break;
      case 'complete':
        result = result.filter(a => !a.needsRefresh);
        break;
    }
    
    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'albumCount':
          comparison = a.albumCount - b.albumCount;
          break;
        case 'issues':
          comparison = a.issues.length - b.issues.length;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return result;
  }, [artists, deferredSearch, filter, sortField, sortDirection]);

  // Reset the render window whenever the visible data set changes
  useEffect(() => {
    setVisibleCount(RENDER_CHUNK);
  }, [deferredSearch, filter, sortField, sortDirection, artists]);

  const visibleArtists = useMemo(
    () => filteredArtists.slice(0, visibleCount),
    [filteredArtists, visibleCount]
  );

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? 
      <ChevronUp className="h-4 w-4 inline ml-1" /> : 
      <ChevronDown className="h-4 w-4 inline ml-1" />;
  };

  // Don't render for non-admin users
  if (authLoading || !user || !isAdmin) {
    return null;
  }

  return (
    <>
      <PageHeader
        title="Lidarr Library"
        description="View the health of your Lidarr library"
      >
        <div className="flex gap-2">
          {fixJob?.status === 'running' ? (
            <Button 
              variant="outline" 
              onClick={handleCancelFix} 
              disabled={isCancellingFix}
              className="text-status-error border-status-error hover:bg-status-error/10"
            >
              <XCircle className={`h-4 w-4 mr-2 ${isCancellingFix ? 'animate-spin' : ''}`} />
              {isCancellingFix ? 'Cancelling...' : 'Cancel Fix'}
            </Button>
          ) : (
            <Button 
              variant="outline" 
              onClick={handleFixAllClick} 
              disabled={artistsNeedingFix === 0 || isStartingFix || isLoading}
            >
              <Wrench className={`h-4 w-4 mr-2 ${isStartingFix ? 'animate-spin' : ''}`} />
              Fix All{artistsNeedingFix > 0 ? ` (${artistsNeedingFix})` : ''}
            </Button>
          )}
          <Button variant="outline" onClick={fetchArtists} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </PageHeader>

      {/* Health Score */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className={`text-2xl font-bold ${healthScore >= 80 ? 'text-status-success' : healthScore >= 50 ? 'text-status-warning' : 'text-status-error'}`}>
              {healthScore}%
            </div>
            <div className="flex-1">
              <div className="text-sm text-muted-foreground mb-1">Library Health</div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all ${healthScore >= 80 ? 'bg-status-success' : healthScore >= 50 ? 'bg-status-warning' : 'bg-status-error'}`}
                  style={{ width: `${healthScore}%` }} 
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fix Progress Bar */}
      {fixJob?.status === 'running' && (
        <Card className="mb-4 border-primary/50">
          <CardContent className="pt-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 animate-spin text-primary" />
                  <span className="font-medium">Fixing Library Metadata</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleCancelFix}
                  disabled={isCancellingFix}
                  className="text-status-error hover:text-status-error hover:bg-status-error/10"
                >
                  <XCircle className={`h-4 w-4 mr-1 ${isCancellingFix ? 'animate-spin' : ''}`} />
                  {isCancellingFix ? 'Cancelling...' : 'Cancel'}
                </Button>
              </div>
              
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${fixJob.total > 0 ? (fixJob.processed / fixJob.total) * 100 : 0}%` }} 
                />
              </div>
              
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span>{fixJob.processed} / {fixJob.total} artists</span>
                  <span className="text-status-success">✓ {fixJob.fixed} fixed</span>
                  {fixJob.failed > 0 && (
                    <span className="text-status-error">✗ {fixJob.failed} failed</span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {fixJob.currentArtist && (
                    <span className="truncate max-w-48">Current: {fixJob.currentArtist}</span>
                  )}
                  <span className="font-medium">
                    {fixJob.total > 0 ? Math.round((fixJob.processed / fixJob.total) * 100) : 0}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onChange={(v) => setActiveTab(v as TabType)} className="mb-6">
        <Tab value="health" label="Health Issues" icon={<AlertTriangle className="w-4 h-4" />} />
        <Tab value="duplicates" label="Duplicates" badge={duplicateCount > 0 ? duplicateCount : undefined} icon={<Copy className="w-4 h-4" />} />
        <TabPanel value="duplicates">
          <DuplicatesContent onCountChange={handleDuplicateCountChange} />
        </TabPanel>
        <TabPanel value="health">
          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-5 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{artists.length}</div>
                <p className="text-xs text-muted-foreground">Total Artists</p>
              </CardContent>
            </Card>
        <Card className={issueStats?.noAlbums ? 'border-status-warning/50' : ''}>
          <CardContent className="pt-4">
            <div className={`text-2xl font-bold ${issueStats?.noAlbums ? 'text-status-warning' : 'text-status-success'}`}>
              {issueStats?.noAlbums || 0}
            </div>
            <p className="text-xs text-muted-foreground">No Albums</p>
          </CardContent>
        </Card>
        <Card className={issueStats?.noPoster ? 'border-status-warning/50' : ''}>
          <CardContent className="pt-4">
            <div className={`text-2xl font-bold ${issueStats?.noPoster ? 'text-status-warning' : 'text-status-success'}`}>
              {issueStats?.noPoster || 0}
            </div>
            <p className="text-xs text-muted-foreground">No Poster</p>
          </CardContent>
        </Card>
        <Card className={issueStats?.noOverview ? 'border-status-warning/50' : ''}>
          <CardContent className="pt-4">
            <div className={`text-2xl font-bold ${issueStats?.noOverview ? 'text-status-warning' : 'text-status-success'}`}>
              {issueStats?.noOverview || 0}
            </div>
            <p className="text-xs text-muted-foreground">No Bio</p>
          </CardContent>
        </Card>
        <Card className={issueStats?.noGenres ? 'border-status-warning/50' : ''}>
          <CardContent className="pt-4">
            <div className={`text-2xl font-bold ${issueStats?.noGenres ? 'text-status-warning' : 'text-status-success'}`}>
              {issueStats?.noGenres || 0}
            </div>
            <p className="text-xs text-muted-foreground">No Genres</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search artists..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            {/* Filter */}
            <div className="w-full md:w-48">
              <Select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterType)}
                options={[
                  { value: 'all', label: 'All Artists' },
                  { value: 'needs_refresh', label: 'Needs Refresh' },
                  { value: 'no_albums', label: 'No Albums' },
                  { value: 'no_poster', label: 'No Poster' },
                  { value: 'no_overview', label: 'No Bio' },
                  { value: 'no_genres', label: 'No Genres' },
                  { value: 'complete', label: 'Complete' },
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Artists Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Artists ({filteredArtists.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-3 px-4">
                  <Skeleton className="w-10 h-10 rounded-md" />
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-12" />
                  <div className="flex gap-2 ml-auto">
                    <Skeleton className="w-5 h-5 rounded" />
                    <Skeleton className="w-5 h-5 rounded" />
                    <Skeleton className="w-5 h-5 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredArtists.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {artists.length === 0 ? 'No artists found in Lidarr' : 'No artists match your filters'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th 
                      className="text-left py-3 px-2 cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleSort('name')}
                    >
                      Artist <SortIcon field="name" />
                    </th>
                    <th 
                      className="text-center py-3 px-2 cursor-pointer hover:bg-muted/50 w-24"
                      onClick={() => toggleSort('albumCount')}
                    >
                      Albums <SortIcon field="albumCount" />
                    </th>
                    <th className="text-center py-3 px-2 w-32">Status</th>
                    <th 
                      className="text-center py-3 px-2 cursor-pointer hover:bg-muted/50 w-24"
                      onClick={() => toggleSort('issues')}
                    >
                      Issues <SortIcon field="issues" />
                    </th>
                    <th className="text-center py-3 px-2 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleArtists.map((artist) => (
                    <tr key={artist.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-2">
                        <div className="font-medium">{artist.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {artist.trackFileCount} / {artist.trackCount} tracks
                        </div>
                      </td>
                      <td className="text-center py-3 px-2">
                        <span className={artist.albumCount === 0 ? 'text-status-warning font-medium' : ''}>
                          {artist.albumCount}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <span title={artist.hasPoster ? 'Has poster' : 'No poster'}>
                            <Image className={`h-4 w-4 ${artist.hasPoster ? 'text-status-success' : 'text-status-warning'}`} />
                          </span>
                          <span title={artist.hasOverview ? 'Has bio' : 'No bio'}>
                            <FileText className={`h-4 w-4 ${artist.hasOverview ? 'text-status-success' : 'text-status-warning'}`} />
                          </span>
                          <span title={artist.hasGenres ? 'Has genres' : 'No genres'}>
                            <Music className={`h-4 w-4 ${artist.hasGenres ? 'text-status-success' : 'text-status-warning'}`} />
                          </span>
                        </div>
                      </td>
                      <td className="text-center py-3 px-2">
                        {artist.issues.length === 0 ? (
                          <Badge variant="default" className="bg-status-success">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            OK
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-status-warning/20 text-status-warning">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {artist.issues.length}
                          </Badge>
                        )}
                      </td>
                      <td className="text-center py-3 px-2">
                        {artist.needsRefresh && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleFixArtist(artist.id)}
                            disabled={fixingArtistId !== null || fixJob?.status === 'running' || isLoading}
                            title="Fix artist metadata"
                          >
                            <Wrench className={`h-4 w-4 ${fixingArtistId === artist.id ? 'animate-spin' : ''}`} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredArtists.length > visibleCount && (
                <div className="flex justify-center py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleCount(c => c + RENDER_CHUNK)}
                  >
                    Show more ({filteredArtists.length - visibleCount} remaining)
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
        </TabPanel>
      </Tabs>

      <ConfirmDialog
        open={confirmFixAll}
        onClose={() => setConfirmFixAll(false)}
        onConfirm={confirmFixAllAction}
        title="Fix metadata?"
        description={`This will attempt to fix metadata for ${artistsNeedingFix} artists with issues. This may take several minutes and will make requests to Lidarr.`}
        confirmLabel="Fix Metadata"
        variant="warning"
      />
    </>
  );
}
