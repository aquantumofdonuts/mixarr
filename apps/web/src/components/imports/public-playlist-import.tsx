'use client';

import { useState } from 'react';
import { Button, Card, CardContent, Input, Modal, Checkbox, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { Link2, Music2, Check, Loader2, ListMusic } from 'lucide-react';

interface PlaylistArtist {
  name: string;
  inLibrary: boolean;
}

interface PreviewData {
  playlistName: string;
  totalTracks: number;
  artistCount: number;
  artists: PlaylistArtist[];
}

export function PublicPlaylistImport({ onImportComplete }: { onImportComplete?: () => void }) {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [includeAllArtists, setIncludeAllArtists] = useState(false);

  const handlePreview = async () => {
    if (!url.trim()) {
      addToast({ type: 'error', title: 'Please enter a playlist URL' });
      return;
    }

    setLoading(true);
    const { data, error } = await api.post<PreviewData>('/api/imports/public-playlist/preview', {
      url,
      includeAllArtists,
    });
    setLoading(false);

    if (error) {
      addToast({ type: 'error', title: 'Failed to fetch playlist', message: error });
      return;
    }

    if (data) {
      setPreviewData(data);
      // Pre-select artists not in library
      setSelectedArtists(new Set(
        data.artists.filter(a => !a.inLibrary).map(a => a.name)
      ));
      setShowModal(true);
    }
  };

  const handleImport = async () => {
    if (selectedArtists.size === 0) {
      addToast({ type: 'error', title: 'Please select at least one artist' });
      return;
    }

    setImporting(true);
    const { data, error } = await api.post<{ message: string }>('/api/imports/public-playlist/import', {
      url,
      selectedArtists: Array.from(selectedArtists),
      includeAllArtists,
    });
    setImporting(false);

    if (error) {
      addToast({ type: 'error', title: 'Import failed', message: error });
      return;
    }

    addToast({
      type: 'success',
      title: 'Import complete',
      message: data?.message,
    });

    setShowModal(false);
    setUrl('');
    setPreviewData(null);
    setSelectedArtists(new Set());
    onImportComplete?.();
  };

  const toggleArtist = (name: string) => {
    const newSet = new Set(selectedArtists);
    if (newSet.has(name)) {
      newSet.delete(name);
    } else {
      newSet.add(name);
    }
    setSelectedArtists(newSet);
  };

  const selectAll = () => {
    if (previewData) {
      setSelectedArtists(new Set(previewData.artists.map(a => a.name)));
    }
  };

  const selectNew = () => {
    if (previewData) {
      setSelectedArtists(new Set(
        previewData.artists.filter(a => !a.inLibrary).map(a => a.name)
      ));
    }
  };

  const deselectAll = () => {
    setSelectedArtists(new Set());
  };

  return (
    <>
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <ListMusic className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <h3 className="font-medium">Import from Public Spotify Playlist</h3>
              <p className="text-sm text-muted-foreground">
                Paste a Spotify playlist URL to import artists (no login required)
              </p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                onKeyDown={(e) => e.key === 'Enter' && handlePreview()}
              />
            </div>
            <Button onClick={handlePreview} disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Link2 className="w-4 h-4 mr-2" />
                  Preview
                </>
              )}
            </Button>
          </div>

          <label className="flex items-center gap-2 mt-3 cursor-pointer text-sm text-muted-foreground">
            <Checkbox
              checked={includeAllArtists}
              onCheckedChange={(checked) => setIncludeAllArtists(!!checked)}
            />
            Include all artists (not just primary)
          </label>
        </CardContent>
      </Card>

      {/* Preview Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={previewData?.playlistName || 'Playlist Preview'}
      >
        {previewData && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{previewData.totalTracks} tracks · {previewData.artistCount} artists</span>
              <span>{selectedArtists.size} selected</span>
            </div>

            {/* Quick select buttons */}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={selectNew}>
                Select New Only
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAll}>
                Deselect All
              </Button>
            </div>

            {/* Artist list */}
            <div className="max-h-80 overflow-y-auto space-y-1 bg-muted/50 rounded-lg p-3">
              {previewData.artists.map((artist) => (
                <label
                  key={artist.name}
                  className={`flex items-center gap-3 p-2 rounded cursor-pointer hover:bg-muted ${
                    artist.inLibrary ? 'opacity-60' : ''
                  }`}
                >
                  <Checkbox
                    checked={selectedArtists.has(artist.name)}
                    onCheckedChange={() => toggleArtist(artist.name)}
                  />
                  <Music2 className="w-4 h-4 text-muted-foreground" />
                  <span className="flex-1">{artist.name}</span>
                  {artist.inLibrary && (
                    <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                      In Library
                    </span>
                  )}
                </label>
              ))}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={importing || selectedArtists.size === 0}
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Import {selectedArtists.size} Artists
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
