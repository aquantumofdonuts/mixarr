'use client';

import { useState, useEffect } from 'react';
import { Button, Card, CardContent, Badge, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { 
  Scan, 
  ExternalLink, 
  X, 
  ChevronDown, 
  ChevronUp,
  Music2,
  HardDrive,
  Disc,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Check,
  FolderOpen,
  Settings2,
  Eye,
  EyeOff
} from 'lucide-react';

interface ArtistInfo {
  id: number;
  artistName: string;
  foreignArtistId: string;
  albumCount?: number;
  trackCount?: number;
  sizeOnDisk?: number;
}

interface DuplicateCandidate {
  artist1: ArtistInfo;
  artist2: ArtistInfo;
  similarity: number;
  matchType: string;
  confidence: 'high' | 'medium' | 'low';
}

interface ScanResult {
  totalArtists: number;
  duplicatesFound: number;
  candidates: DuplicateCandidate[];
  scannedAt: string | null;
  fromCache?: boolean;
}

interface ArtistDetails {
  id: number;
  name: string;
  foreignArtistId: string;
  path: string;
  rootFolder: string;
  qualityProfile: string;
  monitored: boolean;
  albumCount: number;
  trackCount: number;
  trackFileCount: number;
  percentComplete: number;
  sizeOnDisk: number;
  avgBitrate: number | null;
  formats: string[];
  primaryFormat: string | null;
  musicbrainzUrl: string;
}

interface Guidance {
  recommendation: 'keep_first' | 'keep_second' | 'merge_in_musicbrainz';
  reasoning: string;
  firstArtist: ArtistDetails;
  secondArtist: ArtistDetails;
  musicbrainzUrl: string;
  comparison?: {
    artist1: ArtistDetails;
    artist2: ArtistDetails;
  };
}

interface DuplicatesContentProps {
  onCountChange?: (count: number) => void;
}

export function DuplicatesContent({ onCountChange }: DuplicatesContentProps) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<Record<string, Guidance>>({});
  const [loadingGuidance, setLoadingGuidance] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  useEffect(() => {
    fetchDuplicates();
  }, []);

  useEffect(() => {
    if (result) {
      onCountChange?.(result.duplicatesFound);
    }
  }, [result, onCountChange]);

  const fetchDuplicates = async () => {
    setLoading(true);
    const { data, error } = await api.get<ScanResult>('/api/duplicates?minConfidence=low');
    if (error) {
      addToast({ type: 'error', title: 'Failed to load duplicates', message: error });
    } else if (data) {
      setResult(data);
    }
    setLoading(false);
  };

  const handleScan = async () => {
    setScanning(true);
    const { data, error } = await api.post<ScanResult>('/api/duplicates/scan');
    if (error) {
      addToast({ type: 'error', title: 'Scan failed', message: error });
    } else if (data) {
      setResult(data);
      addToast({ 
        type: 'success', 
        title: 'Scan complete', 
        message: `Found ${data.duplicatesFound} potential duplicates` 
      });
    }
    setScanning(false);
  };

  const handleExpand = async (candidate: DuplicateCandidate) => {
    const key = `${candidate.artist1.id}-${candidate.artist2.id}`;
    
    if (expandedId === key) {
      setExpandedId(null);
      return;
    }
    
    setExpandedId(key);
    
    // Fetch guidance if not cached
    if (!guidance[key]) {
      setLoadingGuidance(key);
      const { data } = await api.get<Guidance>(
        `/api/duplicates/${key}/guidance?artist1Id=${candidate.artist1.id}&artist2Id=${candidate.artist2.id}`
      );
      if (data) {
        setGuidance(prev => ({ ...prev, [key]: data }));
      }
      setLoadingGuidance(null);
    }
  };

  const handleDismiss = async (candidate: DuplicateCandidate) => {
    const key = `${candidate.artist1.id}-${candidate.artist2.id}`;
    setDismissing(key);
    
    const { error } = await api.post(`/api/duplicates/${key}/dismiss`, {
      mbid1: candidate.artist1.foreignArtistId,
      mbid2: candidate.artist2.foreignArtistId,
    });
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to dismiss', message: error });
    } else {
      // Remove from list
      if (result) {
        setResult({
          ...result,
          candidates: result.candidates.filter(
            c => !(c.artist1.id === candidate.artist1.id && c.artist2.id === candidate.artist2.id)
          ),
          duplicatesFound: result.duplicatesFound - 1,
        });
      }
      addToast({ type: 'success', title: 'Duplicate dismissed' });
    }
    setDismissing(null);
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(1)} ${units[i]}`;
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return <Badge variant="destructive">High Confidence</Badge>;
      case 'medium':
        return <Badge variant="warning">Medium Confidence</Badge>;
      case 'low':
        return <Badge variant="secondary">Low Confidence</Badge>;
      default:
        return <Badge variant="secondary">{confidence}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Scan button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Find and manage potential duplicate artists in your library
        </p>
        <Button onClick={handleScan} disabled={scanning}>
          {scanning ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Scanning...
            </>
          ) : (
            <>
              <Scan className="w-4 h-4 mr-2" />
              Scan Now
            </>
          )}
        </Button>
      </div>

      {/* Stats */}
      {result && result.scannedAt && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Scanned {result.totalArtists} artists · Found {result.duplicatesFound} potential duplicates
          </span>
          <span>
            Last scan: {new Date(result.scannedAt).toLocaleString()}
            {result.fromCache && ' (cached)'}
          </span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : !result || result.duplicatesFound === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mb-4" />
            <h3 className="text-lg font-medium mb-2">No Duplicates Found</h3>
            <p className="text-muted-foreground mb-4">
              {result?.scannedAt 
                ? 'Your library looks clean! No potential duplicates detected.'
                : 'Click "Scan Now" to check your library for duplicates.'}
            </p>
            {!result?.scannedAt && (
              <Button onClick={handleScan} disabled={scanning}>
                <Scan className="w-4 h-4 mr-2" />
                Start Scan
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {result.candidates.map((candidate) => {
            const key = `${candidate.artist1.id}-${candidate.artist2.id}`;
            const isExpanded = expandedId === key;
            const candidateGuidance = guidance[key];
            
            return (
              <Card key={key} className={candidate.confidence === 'high' ? 'border-red-500/50' : ''}>
                <CardContent className="py-4">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {getConfidenceBadge(candidate.confidence)}
                      <span className="text-sm text-muted-foreground">
                        {Math.round(candidate.similarity * 100)}% similar
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleExpand(candidate)}
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDismiss(candidate)}
                        disabled={dismissing === key}
                      >
                        {dismissing === key ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Artist comparison */}
                  <div className="grid grid-cols-2 gap-8 mt-4">
                    {[candidate.artist1, candidate.artist2].map((artist) => (
                      <div key={artist.id} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Music2 className="w-5 h-5 text-primary" />
                          <span className="font-medium">{artist.artistName}</span>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-2">
                            <Disc className="w-4 h-4" />
                            <span>{artist.albumCount || 0} albums</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <HardDrive className="w-4 h-4" />
                            <span>{formatBytes(artist.sizeOnDisk)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Expanded guidance */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t">
                      {loadingGuidance === key ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : candidateGuidance ? (
                        <div className="space-y-4">
                          {/* Recommendation */}
                          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                            <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
                            <div>
                              <div className="font-medium">Recommendation</div>
                              <div className="text-sm text-muted-foreground">
                                {candidateGuidance.reasoning}
                              </div>
                            </div>
                          </div>
                          
                          {/* Comparison Table */}
                          {candidateGuidance.comparison && (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Attribute</th>
                                    <th className="text-left py-2 px-3 font-medium">{candidateGuidance.comparison.artist1.name}</th>
                                    <th className="text-left py-2 px-3 font-medium">{candidateGuidance.comparison.artist2.name}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {/* Path */}
                                  <tr className="border-b border-muted/50">
                                    <td className="py-2 px-3 text-muted-foreground flex items-center gap-2">
                                      <FolderOpen className="w-4 h-4" /> Path
                                    </td>
                                    <td className="py-2 px-3 font-mono text-xs break-all">{candidateGuidance.comparison.artist1.path || '—'}</td>
                                    <td className="py-2 px-3 font-mono text-xs break-all">{candidateGuidance.comparison.artist2.path || '—'}</td>
                                  </tr>
                                  {/* Albums */}
                                  <tr className="border-b border-muted/50">
                                    <td className="py-2 px-3 text-muted-foreground flex items-center gap-2">
                                      <Disc className="w-4 h-4" /> Albums
                                    </td>
                                    <td className="py-2 px-3">
                                      <span className={candidateGuidance.comparison.artist1.albumCount >= candidateGuidance.comparison.artist2.albumCount && candidateGuidance.comparison.artist1.albumCount > 0 ? 'text-green-500 font-medium' : ''}>
                                        {candidateGuidance.comparison.artist1.albumCount}
                                        {candidateGuidance.comparison.artist1.albumCount > candidateGuidance.comparison.artist2.albumCount && <Check className="w-4 h-4 inline ml-1" />}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3">
                                      <span className={candidateGuidance.comparison.artist2.albumCount > candidateGuidance.comparison.artist1.albumCount ? 'text-green-500 font-medium' : ''}>
                                        {candidateGuidance.comparison.artist2.albumCount}
                                        {candidateGuidance.comparison.artist2.albumCount > candidateGuidance.comparison.artist1.albumCount && <Check className="w-4 h-4 inline ml-1" />}
                                      </span>
                                    </td>
                                  </tr>
                                  {/* Downloaded */}
                                  <tr className="border-b border-muted/50">
                                    <td className="py-2 px-3 text-muted-foreground flex items-center gap-2">
                                      <Music2 className="w-4 h-4" /> Downloaded
                                    </td>
                                    <td className="py-2 px-3">
                                      <span className={candidateGuidance.comparison.artist1.percentComplete >= candidateGuidance.comparison.artist2.percentComplete && candidateGuidance.comparison.artist1.trackFileCount > 0 ? 'text-green-500 font-medium' : ''}>
                                        {candidateGuidance.comparison.artist1.trackFileCount}/{candidateGuidance.comparison.artist1.trackCount} ({candidateGuidance.comparison.artist1.percentComplete}%)
                                        {candidateGuidance.comparison.artist1.percentComplete > candidateGuidance.comparison.artist2.percentComplete && <Check className="w-4 h-4 inline ml-1" />}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3">
                                      <span className={candidateGuidance.comparison.artist2.percentComplete > candidateGuidance.comparison.artist1.percentComplete ? 'text-green-500 font-medium' : ''}>
                                        {candidateGuidance.comparison.artist2.trackFileCount}/{candidateGuidance.comparison.artist2.trackCount} ({candidateGuidance.comparison.artist2.percentComplete}%)
                                        {candidateGuidance.comparison.artist2.percentComplete > candidateGuidance.comparison.artist1.percentComplete && <Check className="w-4 h-4 inline ml-1" />}
                                      </span>
                                    </td>
                                  </tr>
                                  {/* Size */}
                                  <tr className="border-b border-muted/50">
                                    <td className="py-2 px-3 text-muted-foreground flex items-center gap-2">
                                      <HardDrive className="w-4 h-4" /> Size
                                    </td>
                                    <td className="py-2 px-3">
                                      <span className={candidateGuidance.comparison.artist1.sizeOnDisk >= candidateGuidance.comparison.artist2.sizeOnDisk && candidateGuidance.comparison.artist1.sizeOnDisk > 0 ? 'text-green-500 font-medium' : ''}>
                                        {formatBytes(candidateGuidance.comparison.artist1.sizeOnDisk)}
                                        {candidateGuidance.comparison.artist1.sizeOnDisk > candidateGuidance.comparison.artist2.sizeOnDisk && <Check className="w-4 h-4 inline ml-1" />}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3">
                                      <span className={candidateGuidance.comparison.artist2.sizeOnDisk > candidateGuidance.comparison.artist1.sizeOnDisk ? 'text-green-500 font-medium' : ''}>
                                        {formatBytes(candidateGuidance.comparison.artist2.sizeOnDisk)}
                                        {candidateGuidance.comparison.artist2.sizeOnDisk > candidateGuidance.comparison.artist1.sizeOnDisk && <Check className="w-4 h-4 inline ml-1" />}
                                      </span>
                                    </td>
                                  </tr>
                                  {/* Bitrate */}
                                  <tr className="border-b border-muted/50">
                                    <td className="py-2 px-3 text-muted-foreground">Avg Bitrate</td>
                                    <td className="py-2 px-3">
                                      <span className={candidateGuidance.comparison.artist1.avgBitrate && (!candidateGuidance.comparison.artist2.avgBitrate || candidateGuidance.comparison.artist1.avgBitrate >= candidateGuidance.comparison.artist2.avgBitrate) ? 'text-green-500 font-medium' : ''}>
                                        {candidateGuidance.comparison.artist1.avgBitrate ? `${candidateGuidance.comparison.artist1.avgBitrate} kbps` : '—'}
                                        {candidateGuidance.comparison.artist1.avgBitrate && candidateGuidance.comparison.artist2.avgBitrate && candidateGuidance.comparison.artist1.avgBitrate > candidateGuidance.comparison.artist2.avgBitrate && <Check className="w-4 h-4 inline ml-1" />}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3">
                                      <span className={candidateGuidance.comparison.artist2.avgBitrate && candidateGuidance.comparison.artist1.avgBitrate && candidateGuidance.comparison.artist2.avgBitrate > candidateGuidance.comparison.artist1.avgBitrate ? 'text-green-500 font-medium' : ''}>
                                        {candidateGuidance.comparison.artist2.avgBitrate ? `${candidateGuidance.comparison.artist2.avgBitrate} kbps` : '—'}
                                        {candidateGuidance.comparison.artist2.avgBitrate && candidateGuidance.comparison.artist1.avgBitrate && candidateGuidance.comparison.artist2.avgBitrate > candidateGuidance.comparison.artist1.avgBitrate && <Check className="w-4 h-4 inline ml-1" />}
                                      </span>
                                    </td>
                                  </tr>
                                  {/* Format */}
                                  <tr className="border-b border-muted/50">
                                    <td className="py-2 px-3 text-muted-foreground">Format</td>
                                    <td className="py-2 px-3">{candidateGuidance.comparison.artist1.primaryFormat || '—'}</td>
                                    <td className="py-2 px-3">{candidateGuidance.comparison.artist2.primaryFormat || '—'}</td>
                                  </tr>
                                  {/* Quality Profile */}
                                  <tr className="border-b border-muted/50">
                                    <td className="py-2 px-3 text-muted-foreground flex items-center gap-2">
                                      <Settings2 className="w-4 h-4" /> Quality Profile
                                    </td>
                                    <td className="py-2 px-3">{candidateGuidance.comparison.artist1.qualityProfile}</td>
                                    <td className="py-2 px-3">{candidateGuidance.comparison.artist2.qualityProfile}</td>
                                  </tr>
                                  {/* Monitored */}
                                  <tr>
                                    <td className="py-2 px-3 text-muted-foreground">Monitored</td>
                                    <td className="py-2 px-3">
                                      {candidateGuidance.comparison.artist1.monitored ? (
                                        <span className="text-green-500 flex items-center gap-1"><Eye className="w-4 h-4" /> Yes</span>
                                      ) : (
                                        <span className="text-muted-foreground flex items-center gap-1"><EyeOff className="w-4 h-4" /> No</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3">
                                      {candidateGuidance.comparison.artist2.monitored ? (
                                        <span className="text-green-500 flex items-center gap-1"><Eye className="w-4 h-4" /> Yes</span>
                                      ) : (
                                        <span className="text-muted-foreground flex items-center gap-1"><EyeOff className="w-4 h-4" /> No</span>
                                      )}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                          
                          {/* Action buttons */}
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(candidateGuidance.firstArtist.musicbrainzUrl, '_blank')}
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              {candidateGuidance.firstArtist.name} on MusicBrainz
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(candidateGuidance.secondArtist.musicbrainzUrl, '_blank')}
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              {candidateGuidance.secondArtist.name} on MusicBrainz
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Unable to load guidance
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
