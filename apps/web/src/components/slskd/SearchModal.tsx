'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import ArrowUpDown from 'lucide-react/dist/esm/icons/arrow-up-down';
import CheckSquare from 'lucide-react/dist/esm/icons/check-square';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Download from 'lucide-react/dist/esm/icons/download';
import FileAudio from 'lucide-react/dist/esm/icons/file-audio';
import Filter from 'lucide-react/dist/esm/icons/filter';
import HardDrive from 'lucide-react/dist/esm/icons/hard-drive';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Music from 'lucide-react/dist/esm/icons/music';
import Search from 'lucide-react/dist/esm/icons/search';
import Square from 'lucide-react/dist/esm/icons/square';
import User from 'lucide-react/dist/esm/icons/user';
import X from 'lucide-react/dist/esm/icons/x';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';

interface SlskdSearchFile {
  filename: string;
  size: number;
  extension?: string;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
}

interface SlskdSearchResponse {
  username: string;
  uploadSpeed: number;
  queueLength: number;
  hasFreeUploadSlot: boolean;
  files: SlskdSearchFile[];
}

interface SlskdSearchResult {
  id: string;
  searchText: string;
  state: string;
  fileCount: number;
  responseCount: number;
  responses: SlskdSearchResponse[];
}

type FormatFilter = 'all' | 'lossless' | 'mp3-320';
type SortBy = 'quality' | 'size' | 'fileCount';

interface SlskdSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  artistName: string;
  artistImage?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileFormat(file: SlskdSearchFile): string {
  const ext = file.extension?.toLowerCase() || file.filename.split('.').pop()?.toLowerCase() || '';
  if (['flac', 'ape', 'wav', 'alac'].includes(ext)) return 'FLAC';
  if (ext === 'mp3' && file.bitRate && file.bitRate >= 320) return 'MP3-320';
  if (ext === 'mp3' && file.bitRate && file.bitRate >= 256) return 'MP3-256';
  if (ext === 'mp3') return 'MP3';
  if (['ogg', 'opus'].includes(ext)) return 'OGG';
  if (ext === 'm4a') return 'AAC';
  return ext.toUpperCase();
}

function getFolderName(files: SlskdSearchFile[]): string {
  if (files.length === 0) return 'Unknown';
  const firstFile = files[0].filename;
  const parts = firstFile.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : parts[0];
}

function isLossless(file: SlskdSearchFile): boolean {
  const format = getFileFormat(file);
  return ['FLAC', 'APE', 'WAV', 'ALAC'].includes(format);
}

function scoreResult(response: SlskdSearchResponse): number {
  let score = 0;
  
  // Prefer lossless
  const hasLossless = response.files.some(isLossless);
  if (hasLossless) score += 50;
  
  // Upload speed (higher is better)
  score += Math.min(response.uploadSpeed / 100000, 30); // Max 30 points
  
  // Free upload slot
  if (response.hasFreeUploadSlot) score += 10;
  
  // Queue length (lower is better)
  score -= Math.min(response.queueLength / 10, 10); // Max -10 points
  
  return score;
}

export function SlskdSearchModal({ isOpen, onClose, artistName, artistImage }: SlskdSearchModalProps) {
  const [searchId, setSearchId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [results, setResults] = useState<SlskdSearchResult | null>(null);
  const [selectedResults, setSelectedResults] = useState<Set<number>>(new Set());
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('quality');
  const [isDownloading, setIsDownloading] = useState(false);
  const { addToast } = useToast();

  // Start search when modal opens
  useEffect(() => {
    if (isOpen && !searchId) {
      startSearch();
    }
  }, [isOpen]);

  // Countdown timer during search
  useEffect(() => {
    if (!isSearching) return;
    
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isSearching]);

  // Poll for results with exponential backoff
  useEffect(() => {
    if (!searchId) return;
    
    let pollDelay = 2000; // Start at 2 seconds
    let timeoutId: NodeJS.Timeout;
    
    const poll = async () => {
      try {
        const { data, error } = await api.get<SlskdSearchResult>(`/api/slskd/search/${searchId}`);
        if (error) throw new Error(error);
        
        if (data) {
          setResults(data);
          
          // Stop searching when complete
          if (data.state === 'Completed' || data.state === 'Errored') {
            setIsSearching(false);
            setSearchId(null);
            return; // Stop polling
          }
          
          // Continue polling with exponential backoff (2s → 3s → 4.5s → 10s max)
          pollDelay = Math.min(pollDelay * 1.5, 10000);
          timeoutId = setTimeout(poll, pollDelay);
        }
      } catch (err) {
        console.error('Failed to poll search results:', err);
      }
    };
    
    // Start polling
    poll();
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [searchId]);

  const startSearch = async () => {
    setIsSearching(true);
    setCountdown(30);
    setResults(null);
    setSelectedResults(new Set());
    
    try {
      const { data, error } = await api.post<SlskdSearchResult>('/api/slskd/search', {
        query: artistName,
        options: {
          searchTimeout: 30000,
          filterResponses: true,
          minimumPeerUploadSpeed: 0,
        },
      });
      
      if (error) throw new Error(error);
      if (data) {
        setSearchId(data.id);
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Search failed', message: String(err) });
      setIsSearching(false);
    }
  };

  const handleDownloadSelected = async () => {
    if (!results || selectedResults.size === 0) return;
    
    setIsDownloading(true);
    const responses = results.responses.filter((_, idx) => selectedResults.has(idx));
    
    try {
      for (const response of responses) {
        await api.post('/api/slskd/download', {
          username: response.username,
          files: response.files,
          artistName,
        });
      }
      
      addToast({ 
        type: 'success', 
        title: `${responses.length} download(s) queued`,
        message: 'Check the Downloads page for progress'
      });
      
      setSelectedResults(new Set());
      onClose();
    } catch (err) {
      addToast({ type: 'error', title: 'Download failed', message: String(err) });
    }
    
    setIsDownloading(false);
  };

  const toggleSelect = (idx: number) => {
    const newSelected = new Set(selectedResults);
    if (newSelected.has(idx)) {
      newSelected.delete(idx);
    } else {
      newSelected.add(idx);
    }
    setSelectedResults(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedResults.size === filteredResults.length) {
      setSelectedResults(new Set());
    } else {
      setSelectedResults(new Set(filteredResults.map((_, idx) => idx)));
    }
  };

  // Filter and sort results
  const filteredResults = (results?.responses || [])
    .map((response, originalIdx) => ({ response, originalIdx }))
    .filter(({ response }) => {
      if (formatFilter === 'all') return true;
      if (formatFilter === 'lossless') {
        return response.files.some(isLossless);
      }
      if (formatFilter === 'mp3-320') {
        return response.files.some(f => getFileFormat(f) === 'MP3-320');
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'quality') {
        return scoreResult(b.response) - scoreResult(a.response);
      }
      if (sortBy === 'size') {
        const sizeA = a.response.files.reduce((sum, f) => sum + f.size, 0);
        const sizeB = b.response.files.reduce((sum, f) => sum + f.size, 0);
        return sizeB - sizeA;
      }
      if (sortBy === 'fileCount') {
        return b.response.files.length - a.response.files.length;
      }
      return 0;
    });

  const handleClose = () => {
    // Cancel search if still running
    if (searchId) {
      api.delete(`/api/slskd/search/${searchId}`).catch(console.error);
      setSearchId(null);
    }
    setIsSearching(false);
    setResults(null);
    setSelectedResults(new Set());
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Search Soulseek"
      size="xl"
    >
      {/* Header with artist info */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
          {artistImage ? (
            <Image src={artistImage} alt={artistName} fill className="object-cover" unoptimized />
          ) : (
            <Music className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold truncate">{artistName}</h3>
          <p className="text-sm text-muted-foreground">
            {isSearching && `Searching... ${countdown}s remaining`}
            {!isSearching && results && `Found ${results.responseCount} sources with ${results.fileCount} files`}
            {!isSearching && !results && 'Ready to search'}
          </p>
        </div>
      </div>

      {/* Searching state */}
      {isSearching && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Searching Soulseek network...</p>
          <p className="text-sm text-muted-foreground mt-2">{countdown} seconds remaining</p>
        </div>
      )}

      {/* Results */}
      {!isSearching && results && (
        <>
          {/* Filters and actions */}
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <div className="flex gap-2 flex-wrap">
              {/* Format filter */}
              <div className="flex items-center gap-1">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <select
                  value={formatFilter}
                  onChange={(e) => setFormatFilter(e.target.value as FormatFilter)}
                  className="text-sm border rounded px-2 py-1"
                >
                  <option value="all">All Formats</option>
                  <option value="lossless">Lossless Only</option>
                  <option value="mp3-320">MP3-320+</option>
                </select>
              </div>
              
              {/* Sort */}
              <div className="flex items-center gap-1">
                <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="text-sm border rounded px-2 py-1"
                >
                  <option value="quality">Best Quality</option>
                  <option value="size">Largest</option>
                  <option value="fileCount">Most Files</option>
                </select>
              </div>
            </div>

            {/* Bulk actions */}
            <div className="flex gap-2">
              {filteredResults.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleSelectAll}
                >
                  {selectedResults.size === filteredResults.length ? 'Deselect All' : 'Select All'}
                </Button>
              )}
              {selectedResults.size > 0 && (
                <Button
                  size="sm"
                  onClick={handleDownloadSelected}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download Selected ({selectedResults.size})
                </Button>
              )}
            </div>
          </div>

          {/* Results list */}
          {filteredResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <XCircle className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-semibold">No results found</p>
              <p className="text-sm text-muted-foreground mt-2">
                {formatFilter !== 'all' 
                  ? 'Try adjusting your filters or search for a different artist.'
                  : 'No sources found for this artist on Soulseek.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {filteredResults.map(({ response, originalIdx }, displayIdx) => {
                const folderName = getFolderName(response.files);
                const totalSize = response.files.reduce((sum, f) => sum + f.size, 0);
                const formats = [...new Set(response.files.map(getFileFormat))];
                const hasLosslessFiles = response.files.some(isLossless);
                
                return (
                  <div
                    key={displayIdx}
                    className="border rounded-lg p-4 hover:border-primary transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleSelect(originalIdx)}
                        className="mt-1"
                      >
                        {selectedResults.has(originalIdx) ? (
                          <CheckSquare className="h-5 w-5 text-primary" />
                        ) : (
                          <Square className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                      
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold truncate mb-2">{folderName}</h4>
                        
                        <div className="flex flex-wrap gap-2 mb-2">
                          {formats.map((format, i) => (
                            <Badge 
                              key={i} 
                              variant={hasLosslessFiles ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {format}
                            </Badge>
                          ))}
                        </div>
                        
                        <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <FileAudio className="h-3 w-3" />
                            {response.files.length} files
                          </span>
                          <span className="flex items-center gap-1">
                            <HardDrive className="h-3 w-3" />
                            {formatBytes(totalSize)}
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {response.username}
                          </span>
                          {response.hasFreeUploadSlot && (
                            <Badge variant="success" className="text-xs">Free Slot</Badge>
                          )}
                          {response.queueLength > 0 && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Queue: {response.queueLength}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
        <Button variant="outline" onClick={handleClose}>
          <X className="h-4 w-4 mr-2" />
          Close
        </Button>
        {!isSearching && !results && (
          <Button onClick={startSearch}>
            <Search className="h-4 w-4 mr-2" />
            Start Search
          </Button>
        )}
      </div>
    </Modal>
  );
}
