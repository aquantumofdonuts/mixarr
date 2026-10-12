'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResultState } from '@/components/ui/result-state';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Download from 'lucide-react/dist/esm/icons/download';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Music2 from 'lucide-react/dist/esm/icons/music-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';

interface Artist {
  id?: string;
  name: string;
  images?: Array<{ url: string }>;
  genres?: string[];
  playcount?: string;
  listeners?: string;
  mbid?: string;
  url?: string;
}

interface AIRecommendation {
  name: string;
  source: string;
  strategy: string;
}

interface PreviewData {
  connection: { id: number; name: string };
  artists: Artist[];
  similarArtists?: Artist[];
  aiRecommendations: AIRecommendation[];
  total: number;
  filtered: number;
}

export default function PreviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { addToast } = useToast();

  const connectionId = searchParams.get('connectionId');
  const connectionType = searchParams.get('type') as 'spotify' | 'lastfm' | null;

  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [previewError, setPreviewError] = useState('');
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<Array<{ name: string; success: boolean; message: string }>>([]);

  const fetchPreview = useCallback(async (includeAI = true, includeSimilar = true) => {
    if (!connectionId || !connectionType) return;

    setIsLoading(true);
    setPreviewError('');
    const params = new URLSearchParams();
    if (includeAI) params.set('ai', 'true');
    if (includeSimilar && connectionType === 'lastfm') params.set('similar', 'true');

    const { data, error } = await api.get<PreviewData>(
      `/api/imports/preview/${connectionType}/${connectionId}?${params}`
    );

    if (data) {
      setPreviewData(data);
      // Auto-select all artists by default
      setSelectedArtists(new Set(data.artists.map(a => a.name)));
    }
    if (error) {
      setPreviewError(error);
      setPreviewData(null);
      setSelectedArtists(new Set());
    }
    setIsLoading(false);
  }, [connectionId, connectionType]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const toggleArtist = (name: string) => {
    const newSelected = new Set(selectedArtists);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedArtists(newSelected);
  };

  const selectAll = () => {
    if (!previewData) return;
    const allNames = [
      ...previewData.artists.map(a => a.name),
      ...(previewData.similarArtists?.map(a => a.name) || []),
      ...previewData.aiRecommendations.map(a => a.name),
    ];
    setSelectedArtists(new Set(allNames));
  };

  const selectNone = () => {
    setSelectedArtists(new Set());
  };

  const handleImport = async () => {
    if (selectedArtists.size === 0) {
      addToast({ type: 'error', title: 'No artists selected' });
      return;
    }

    setIsImporting(true);
    const { data, error } = await api.post<{
      success: boolean;
      message: string;
      results: Array<{ name: string; success: boolean; message: string }>;
    }>('/api/imports/preview/import', {
      artistNames: Array.from(selectedArtists),
    });

    if (data) {
      setImportResults(data.results);
      addToast({
        type: data.success ? 'success' : 'error',
        title: data.message,
      });
      
      // Remove successfully imported artists from preview
      if (previewData) {
        const successNames = new Set(data.results.filter(r => r.success).map(r => r.name.toLowerCase()));
        setPreviewData({
          ...previewData,
          artists: previewData.artists.filter(a => !successNames.has(a.name.toLowerCase())),
          similarArtists: previewData.similarArtists?.filter(a => !successNames.has(a.name.toLowerCase())),
          aiRecommendations: previewData.aiRecommendations.filter(a => !successNames.has(a.name.toLowerCase())),
        });
        // Update selection
        const newSelected = new Set(selectedArtists);
        successNames.forEach(name => {
          // Find and remove the actual case-sensitive name
          Array.from(newSelected).forEach(n => {
            if (n.toLowerCase() === name) newSelected.delete(n);
          });
        });
        setSelectedArtists(newSelected);
      }
    }
    if (error) {
      addToast({ type: 'error', title: 'Import failed', message: error });
    }
    setIsImporting(false);
  };

  if (!connectionId || !connectionType) {
    return (
      <>
        <PageHeader title="Preview artists" />
        <div className="border-y py-6">
          <p className="mb-4 text-muted-foreground">No connection specified</p>
          <Button onClick={() => router.push('/connections')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Connections
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Preview ${connectionType === 'spotify' ? 'Spotify' : 'Last.fm'} Artists`}
        description={previewData ? <><span className="font-mono">{previewData.total}</span> artists not in your Lidarr library (<span className="font-mono">{previewData.filtered}</span> filtered)</> : isLoading ? 'Loading artists…' : 'Review artists from this connection.'}
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push('/connections')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <Button variant="outline" onClick={() => fetchPreview()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button
            onClick={handleImport}
            disabled={isImporting || isLoading || selectedArtists.size === 0}
          >
            <Download className={`h-4 w-4 mr-2 ${isImporting ? 'animate-pulse' : ''}`} />
            <span>Import <span className="font-mono">{selectedArtists.size}</span> Artist{selectedArtists.size !== 1 ? 's' : ''}</span>
          </Button>
        </div>
      </PageHeader>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : previewError ? (
        <ResultState kind="error" message={previewError} action={<Button variant="outline" onClick={() => fetchPreview()}>Retry</Button>} />
      ) : previewData ? (
        <div className="space-y-4">
          {/* Selection Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={selectNone}>
              Select None
            </Button>
            <span className="font-mono text-sm text-muted-foreground">
              {selectedArtists.size} selected
            </span>
          </div>

          {/* Import Results */}
          {importResults.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Import Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {importResults.map((result, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {result.success ? (
                        <CheckCircle className="h-4 w-4 text-status-success" />
                      ) : (
                        <XCircle className="h-4 w-4 text-status-error" />
                      )}
                      <span className={result.success ? 'text-status-success' : 'text-status-error'}>
                        {result.name}: {result.message}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Main Artists */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>
                  {connectionType === 'spotify' ? 'Your Spotify Artists' : 'Top Artists'}
                </CardTitle>
              </div>
              <CardDescription>
                <span className="font-mono">{previewData.artists.length}</span> artists from your {connectionType === 'spotify' ? 'followed artists and liked songs' : 'charts'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {previewData.artists.length === 0 ? (
                <ResultState kind="no-records" message="This source returned no artists available to import." />
              ) : (
                <div className="divide-y border-y">
                  {previewData.artists.map((artist) => (
                    <label
                      key={artist.id || artist.name}
                      className={`flex min-w-0 items-center gap-3 px-2 py-3 cursor-pointer transition-colors ${
                        selectedArtists.has(artist.name)
                          ? 'bg-muted'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-foreground" aria-label={`Select ${artist.name}`} checked={selectedArtists.has(artist.name)} onChange={() => toggleArtist(artist.name)} />
                      {artist.images?.[0]?.url ? (
                        <img
                          src={artist.images[0].url}
                          alt={artist.name}
                          className="h-10 w-10 rounded-button object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-button bg-muted flex items-center justify-center">
                          <Music2 className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{artist.name}</p>
                        {artist.listeners && (
                          <p className="text-xs font-mono text-muted-foreground tabular-nums">
                            {parseInt(artist.listeners).toLocaleString()} listeners
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Similar Artists (Last.fm only) */}
          {previewData.similarArtists && previewData.similarArtists.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>Similar Artists</CardTitle>
                </div>
                <CardDescription>
                  Artists similar to your top artist
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y border-y">
                  {previewData.similarArtists.map((artist) => (
                    <label
                      key={artist.name}
                      className={`flex min-w-0 items-center gap-3 px-2 py-3 cursor-pointer transition-colors ${
                        selectedArtists.has(artist.name)
                          ? 'bg-muted'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-foreground" aria-label={`Select ${artist.name}`} checked={selectedArtists.has(artist.name)} onChange={() => toggleArtist(artist.name)} />
                      <div className="h-10 w-10 rounded-button bg-muted flex items-center justify-center">
                        <Music2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{artist.name}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Recommendations */}
          {previewData.aiRecommendations.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>AI Recommendations</CardTitle>
                </div>
                <CardDescription>
                  Suggested artists based on your taste
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y border-y">
                  {previewData.aiRecommendations.map((rec) => (
                    <label
                      key={rec.name}
                      className={`flex min-w-0 items-center gap-3 px-2 py-3 cursor-pointer transition-colors ${
                        selectedArtists.has(rec.name)
                          ? 'bg-muted'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-foreground" aria-label={`Select ${rec.name}`} checked={selectedArtists.has(rec.name)} onChange={() => toggleArtist(rec.name)} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{rec.name}</p>
                        <p className="text-xs text-muted-foreground">
                          via {rec.source} • {rec.strategy}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
<ResultState kind="no-records" message="This connection returned no preview data." />
      )}
    </>
  );
}
