# Phase 5: UI Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add connection configuration UIs for new services, discography browsing, and download management.

---

## Task 1: Plex Connection UI

**Files:**
- Create: `apps/web/src/app/connections/plex/page.tsx`
- Create: `apps/web/src/components/connections/PlexConnectionForm.tsx`

**Step 1: Create PlexConnectionForm component**

```typescript
// apps/web/src/components/connections/PlexConnectionForm.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';

interface PlexConnectionFormProps {
  onSuccess?: () => void;
}

type AuthMode = 'oauth' | 'token';

export function PlexConnectionForm({ onSuccess }: PlexConnectionFormProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('oauth');
  const [isLoading, setIsLoading] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const { toast } = useToast();

  const handleOAuthLogin = async () => {
    setIsLoading(true);
    try {
      // Request PIN from API
      const pinRes = await fetch('/api/plex/auth/pin', { method: 'POST' });
      const { id, code, authUrl } = await pinRes.json();
      
      // Open Plex auth in new window
      const authWindow = window.open(authUrl, '_blank', 'width=800,height=600');
      
      // Poll for completion
      const pollInterval = setInterval(async () => {
        const checkRes = await fetch(`/api/plex/auth/check?id=${id}`);
        const { completed, authToken } = await checkRes.json();
        
        if (completed) {
          clearInterval(pollInterval);
          authWindow?.close();
          await saveConnection(authToken);
        }
      }, 2000);

      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(pollInterval), 300000);
    } catch (error) {
      toast({
        title: 'OAuth Failed',
        description: 'Failed to start Plex authentication',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualToken = async () => {
    if (!manualToken || !serverUrl) {
      toast({
        title: 'Missing Fields',
        description: 'Please enter both server URL and token',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      await saveConnection(manualToken, serverUrl);
    } finally {
      setIsLoading(false);
    }
  };

  const saveConnection = async (token: string, url?: string) => {
    const res = await fetch('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'plex',
        name: 'Plex',
        url: url || serverUrl,
        apiKey: token,
      }),
    });

    if (res.ok) {
      toast({ title: 'Connected', description: 'Plex connected successfully' });
      onSuccess?.();
    } else {
      toast({
        title: 'Connection Failed',
        description: 'Failed to save Plex connection',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect to Plex</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant={authMode === 'oauth' ? 'default' : 'outline'}
            onClick={() => setAuthMode('oauth')}
          >
            Sign in with Plex
          </Button>
          <Button
            variant={authMode === 'token' ? 'default' : 'outline'}
            onClick={() => setAuthMode('token')}
          >
            Manual Token
          </Button>
        </div>

        {authMode === 'oauth' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Click below to sign in with your Plex account. A new window will open.
            </p>
            <Button onClick={handleOAuthLogin} disabled={isLoading}>
              {isLoading ? 'Authenticating...' : 'Sign in with Plex'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="serverUrl">Server URL</Label>
              <Input
                id="serverUrl"
                placeholder="http://192.168.1.100:32400"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="token">X-Plex-Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="Your Plex token"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
              />
            </div>
            <Button onClick={handleManualToken} disabled={isLoading}>
              {isLoading ? 'Connecting...' : 'Connect'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

**Step 2: Create page**

```typescript
// apps/web/src/app/connections/plex/page.tsx
import { PlexConnectionForm } from '@/components/connections/PlexConnectionForm';

export default function PlexConnectionPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Plex Connection</h1>
      <PlexConnectionForm />
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add apps/web/src/app/connections/plex apps/web/src/components/connections/PlexConnectionForm.tsx
git commit -m "feat(ui): add Plex connection page with OAuth support"
```

---

## Task 2: Prowlarr Connection UI

**Files:**
- Create: `apps/web/src/app/connections/prowlarr/page.tsx`
- Create: `apps/web/src/components/connections/ProwlarrConnectionForm.tsx`

**Step 1: Create form component**

```typescript
// apps/web/src/components/connections/ProwlarrConnectionForm.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface ProwlarrConnectionFormProps {
  existingConnection?: {
    url: string;
    apiKey: string;
  };
  onSuccess?: () => void;
}

export function ProwlarrConnectionForm({ 
  existingConnection, 
  onSuccess 
}: ProwlarrConnectionFormProps) {
  const [url, setUrl] = useState(existingConnection?.url || '');
  const [apiKey, setApiKey] = useState(existingConnection?.apiKey || '');
  const [isLoading, setIsLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const { toast } = useToast();

  const handleTest = async () => {
    if (!url || !apiKey) {
      toast({
        title: 'Missing Fields',
        description: 'Please enter both URL and API key',
        variant: 'destructive',
      });
      return;
    }

    setTestStatus('testing');
    try {
      const res = await fetch('/api/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'prowlarr', url, apiKey }),
      });

      if (res.ok) {
        setTestStatus('success');
        toast({ title: 'Success', description: 'Connection test passed' });
      } else {
        setTestStatus('error');
        toast({
          title: 'Test Failed',
          description: 'Could not connect to Prowlarr',
          variant: 'destructive',
        });
      }
    } catch {
      setTestStatus('error');
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'prowlarr',
          name: 'Prowlarr',
          url,
          apiKey,
        }),
      });

      if (res.ok) {
        toast({ title: 'Saved', description: 'Prowlarr connection saved' });
        onSuccess?.();
      } else {
        toast({
          title: 'Save Failed',
          description: 'Could not save connection',
          variant: 'destructive',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect to Prowlarr</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="url">Prowlarr URL</Label>
          <Input
            id="url"
            placeholder="http://localhost:9696"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="apiKey">API Key</Label>
          <Input
            id="apiKey"
            type="password"
            placeholder="Found in Prowlarr Settings → General"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testStatus === 'testing'}>
            {testStatus === 'testing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {testStatus === 'success' && <CheckCircle className="mr-2 h-4 w-4 text-green-500" />}
            {testStatus === 'error' && <XCircle className="mr-2 h-4 w-4 text-red-500" />}
            Test Connection
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

**Step 2: Create page and commit**

---

## Task 3: SABnzbd Connection UI

**Files:**
- Create: `apps/web/src/app/connections/sabnzbd/page.tsx`
- Create: `apps/web/src/components/connections/SabnzbdConnectionForm.tsx`

Similar structure to Prowlarr with:
- URL field
- API Key field  
- Test connection button
- Save button

---

## Task 4: slskd Connection UI

**Files:**
- Create: `apps/web/src/app/connections/slskd/page.tsx`
- Create: `apps/web/src/components/connections/SlskdConnectionForm.tsx`

Similar structure with:
- URL field
- Username field (slskd API user)
- Password field (slskd API password)
- Test connection button
- Save button

---

## Task 5: Update Connections Overview Page

**Files:**
- Modify: `apps/web/src/app/connections/page.tsx`

Add new connection cards for:
- Plex (with OAuth indicator)
- Prowlarr
- SABnzbd
- slskd

Each card shows:
- Connection status (connected/disconnected)
- Last tested timestamp
- Configure/Edit button

---

## Task 6: Discography Browser Component

**Files:**
- Create: `apps/web/src/components/discography/DiscographyBrowser.tsx`
- Create: `apps/web/src/components/discography/AlbumCard.tsx`

**Step 1: Create AlbumCard**

```typescript
// apps/web/src/components/discography/AlbumCard.tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, Check, Clock } from 'lucide-react';

interface AlbumCardProps {
  album: {
    id: string;
    title: string;
    year?: number;
    artwork?: string;
    source: 'lidarr' | 'spotify' | 'musicbrainz' | 'discogs';
    status: 'in-library' | 'available' | 'downloading';
  };
  onDownload?: () => void;
}

export function AlbumCard({ album, onDownload }: AlbumCardProps) {
  const sourceColors = {
    lidarr: 'bg-green-500',
    spotify: 'bg-emerald-500',
    musicbrainz: 'bg-purple-500',
    discogs: 'bg-orange-500',
  };

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow">
      <div className="aspect-square relative">
        {album.artwork ? (
          <img
            src={album.artwork}
            alt={album.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <span className="text-muted-foreground">No Art</span>
          </div>
        )}
        <Badge className={`absolute top-2 right-2 ${sourceColors[album.source]}`}>
          {album.source}
        </Badge>
      </div>
      
      <div className="p-3 space-y-2">
        <h3 className="font-medium text-sm line-clamp-2">{album.title}</h3>
        {album.year && (
          <p className="text-xs text-muted-foreground">{album.year}</p>
        )}
        
        <div className="flex justify-end">
          {album.status === 'in-library' ? (
            <Button variant="ghost" size="sm" disabled>
              <Check className="h-4 w-4 mr-1" /> In Library
            </Button>
          ) : album.status === 'downloading' ? (
            <Button variant="ghost" size="sm" disabled>
              <Clock className="h-4 w-4 mr-1 animate-pulse" /> Downloading
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onDownload}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
```

**Step 2: Create DiscographyBrowser**

```typescript
// apps/web/src/components/discography/DiscographyBrowser.tsx
'use client';

import { useState, useEffect } from 'react';
import { AlbumCard } from './AlbumCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

interface DiscographyBrowserProps {
  artistId: string;
  artistName: string;
}

interface Album {
  id: string;
  title: string;
  year?: number;
  artwork?: string;
  source: 'lidarr' | 'spotify' | 'musicbrainz' | 'discogs';
  status: 'in-library' | 'available' | 'downloading';
  albumType?: 'album' | 'ep' | 'single' | 'compilation';
}

export function DiscographyBrowser({ artistId, artistName }: DiscographyBrowserProps) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'album' | 'ep' | 'single'>('all');

  useEffect(() => {
    const fetchDiscography = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/discography/${artistId}`);
        const data = await res.json();
        setAlbums(data.albums);
      } catch (error) {
        console.error('Failed to fetch discography:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDiscography();
  }, [artistId]);

  const filteredAlbums = filter === 'all' 
    ? albums 
    : albums.filter(a => a.albumType === filter);

  const handleDownload = async (album: Album) => {
    const res = await fetch('/api/downloads/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: artistName,
        album: album.title,
        year: album.year,
      }),
    });
    
    if (res.ok) {
      setAlbums(prev => 
        prev.map(a => a.id === album.id ? { ...a, status: 'downloading' as const } : a)
      );
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          <TabsTrigger value="all">All ({albums.length})</TabsTrigger>
          <TabsTrigger value="album">
            Albums ({albums.filter(a => a.albumType === 'album').length})
          </TabsTrigger>
          <TabsTrigger value="ep">
            EPs ({albums.filter(a => a.albumType === 'ep').length})
          </TabsTrigger>
          <TabsTrigger value="single">
            Singles ({albums.filter(a => a.albumType === 'single').length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {filteredAlbums.map(album => (
          <AlbumCard
            key={album.id}
            album={album}
            onDownload={() => handleDownload(album)}
          />
        ))}
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add apps/web/src/components/discography
git commit -m "feat(ui): add discography browser component"
```

---

## Task 7: Download Search & Results Modal

**Files:**
- Create: `apps/web/src/components/downloads/DownloadSearchModal.tsx`
- Create: `apps/web/src/components/downloads/DownloadResultRow.tsx`

**Step 1: Create DownloadResultRow**

```typescript
// apps/web/src/components/downloads/DownloadResultRow.tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableRow, TableCell } from '@/components/ui/table';
import { Download } from 'lucide-react';

interface DownloadResult {
  id: string;
  title: string;
  source: 'usenet' | 'soulseek';
  format: 'flac' | 'mp3' | 'aac' | 'unknown';
  size: number;
  score: number;
  indexer?: string;
  uploader?: string;
}

interface DownloadResultRowProps {
  result: DownloadResult;
  onGrab: () => void;
  isGrabbing: boolean;
}

export function DownloadResultRow({ result, onGrab, isGrabbing }: DownloadResultRowProps) {
  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return mb > 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
  };

  const formatColors = {
    flac: 'bg-purple-500',
    mp3: 'bg-blue-500',
    aac: 'bg-green-500',
    unknown: 'bg-gray-500',
  };

  const sourceColors = {
    usenet: 'bg-amber-500',
    soulseek: 'bg-cyan-500',
  };

  return (
    <TableRow>
      <TableCell className="font-medium max-w-md truncate" title={result.title}>
        {result.title}
      </TableCell>
      <TableCell>
        <Badge className={sourceColors[result.source]}>
          {result.source === 'usenet' ? result.indexer : result.uploader}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge className={formatColors[result.format]}>
          {result.format.toUpperCase()}
        </Badge>
      </TableCell>
      <TableCell>{formatSize(result.size)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <div className="w-12 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-green-500" 
              style={{ width: `${result.score}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{result.score}</span>
        </div>
      </TableCell>
      <TableCell>
        <Button size="sm" onClick={onGrab} disabled={isGrabbing}>
          <Download className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
```

**Step 2: Create DownloadSearchModal**

```typescript
// apps/web/src/components/downloads/DownloadSearchModal.tsx
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DownloadResultRow } from './DownloadResultRow';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

interface DownloadSearchModalProps {
  open: boolean;
  onClose: () => void;
  artist: string;
  album: string;
  year?: number;
}

interface SearchResult {
  id: string;
  title: string;
  source: 'usenet' | 'soulseek';
  format: 'flac' | 'mp3' | 'aac' | 'unknown';
  size: number;
  score: number;
  indexer?: string;
  uploader?: string;
}

export function DownloadSearchModal({
  open,
  onClose,
  artist,
  album,
  year,
}: DownloadSearchModalProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [grabbingId, setGrabbingId] = useState<string | null>(null);
  const { toast } = useToast();

  const search = async () => {
    setIsSearching(true);
    try {
      const res = await fetch('/api/downloads/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist, album, year }),
      });
      const data = await res.json();
      setResults(data.results);
    } catch (error) {
      toast({
        title: 'Search Failed',
        description: 'Could not search for downloads',
        variant: 'destructive',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleGrab = async (result: SearchResult) => {
    setGrabbingId(result.id);
    try {
      const res = await fetch('/api/downloads/grab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artist,
          album,
          year,
          result,
        }),
      });

      if (res.ok) {
        toast({
          title: 'Download Started',
          description: `Downloading ${album}`,
        });
        onClose();
      } else {
        toast({
          title: 'Grab Failed',
          description: 'Could not start download',
          variant: 'destructive',
        });
      }
    } finally {
      setGrabbingId(null);
    }
  };

  // Search when modal opens
  useState(() => {
    if (open) search();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            Download: {artist} - {album} {year && `(${year})`}
          </DialogTitle>
        </DialogHeader>

        {isSearching ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Searching...</span>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No results found
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Release</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Score</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map(result => (
                <DownloadResultRow
                  key={result.id}
                  result={result}
                  onGrab={() => handleGrab(result)}
                  isGrabbing={grabbingId === result.id}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Commit**

```bash
git add apps/web/src/components/downloads
git commit -m "feat(ui): add download search modal"
```

---

## Task 8: Download Queue Page

**Files:**
- Create: `apps/web/src/app/downloads/page.tsx`
- Create: `apps/web/src/components/downloads/DownloadQueue.tsx`

Shows:
- Active downloads (with progress)
- Queued downloads
- Completed downloads (last 24h)
- Failed downloads with retry button

---

## Task 9: Artist Page Integration

**Files:**
- Modify: `apps/web/src/app/artists/[id]/page.tsx`

Update existing artist detail page to:
- Show discography from DiscographyService (multi-source)
- Show albums in Plex vs available
- Add download buttons for missing albums

---

## Tasks 10-15: Remaining UI Work

- **Task 10**: Path mapping configuration UI (settings page)
- **Task 11**: Library sync status indicators
- **Task 12**: Download notification toasts
- **Task 13**: Mobile-responsive download modal
- **Task 14**: Keyboard shortcuts for quick actions
- **Task 15**: E2E tests for connection flows

---

See [06-phase6-automation.md](06-phase6-automation.md) for Phase 6.
