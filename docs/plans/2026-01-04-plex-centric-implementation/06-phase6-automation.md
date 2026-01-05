# Phase 6: Automated Flows

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update Discovery and Subscriptions features to use the new Plex-centric add flow instead of Lidarr.

---

## Overview

Currently, the Discovery and Subscriptions features add artists/albums directly to Lidarr. This phase updates them to:

1. **Check Plex first** - Is it already in the library?
2. **Get discography** - From multi-source fallback chain
3. **Download missing** - Via Prowlarr/slskd orchestrator
4. **Post-process** - Move files, trigger Plex scan

---

## Task 1: Create AddToLibrary Service

**Files:**
- Create: `apps/api/src/services/add-to-library.ts`
- Create: `apps/api/src/services/add-to-library.types.ts`
- Create: `apps/api/tests/services/add-to-library.test.ts`

**Step 1: Create types**

```typescript
// apps/api/src/services/add-to-library.types.ts
/**
 * Types for the unified "add to library" flow.
 */

export interface AddArtistRequest {
  artistName: string;
  artistId?: string;              // MusicBrainz, Spotify, etc.
  source?: 'spotify' | 'musicbrainz' | 'lastfm' | 'discogs';
  monitorType?: 'all' | 'future' | 'existing' | 'first' | 'latest' | 'none';
  qualityPreference?: 'flac' | 'mp3' | 'any';
  autoDownload?: boolean;         // Start downloads immediately?
}

export interface AddAlbumRequest {
  artistName: string;
  albumName: string;
  year?: number;
  artistId?: string;
  albumId?: string;
  qualityPreference?: 'flac' | 'mp3' | 'any';
}

export interface AddResult {
  success: boolean;
  alreadyExists?: boolean;
  artistAdded?: boolean;
  albumsQueued?: number;
  downloadJobIds?: string[];
  error?: string;
}

export type MonitorType = 'all' | 'future' | 'existing' | 'first' | 'latest' | 'none';
```

**Step 2: Write failing test**

```typescript
// apps/api/tests/services/add-to-library.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('AddToLibraryService', () => {
  describe('addArtist', () => {
    it('should skip if artist already in Plex', async () => {
      const { AddToLibraryService } = await import(
        '../../src/services/add-to-library.js'
      );
      
      const mockPlex = {
        artistExists: vi.fn().mockResolvedValue(true),
      };
      
      const service = new AddToLibraryService({
        plex: mockPlex as any,
      });

      const result = await service.addArtist({
        artistName: 'Pink Floyd',
      });

      expect(result.alreadyExists).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should fetch discography and queue downloads for new artist', async () => {
      const { AddToLibraryService } = await import(
        '../../src/services/add-to-library.js'
      );
      
      const mockPlex = {
        artistExists: vi.fn().mockResolvedValue(false),
        albumExists: vi.fn().mockResolvedValue(false),
      };
      
      const mockDiscography = {
        getArtistAlbums: vi.fn().mockResolvedValue({
          success: true,
          albums: [
            { id: '1', title: 'The Wall', year: 1979 },
            { id: '2', title: 'Animals', year: 1977 },
          ],
        }),
      };
      
      const mockOrchestrator = {
        searchAndGrabBest: vi.fn().mockResolvedValue({
          success: true,
          downloadId: 'job-123',
        }),
      };
      
      const service = new AddToLibraryService({
        plex: mockPlex as any,
        discography: mockDiscography as any,
        orchestrator: mockOrchestrator as any,
      });

      const result = await service.addArtist({
        artistName: 'Pink Floyd',
        monitorType: 'all',
        autoDownload: true,
      });

      expect(result.success).toBe(true);
      expect(result.albumsQueued).toBe(2);
      expect(mockOrchestrator.searchAndGrabBest).toHaveBeenCalledTimes(2);
    });
  });
});
```

**Step 3: Run test to verify it fails**

**Step 4: Implement service**

```typescript
// apps/api/src/services/add-to-library.ts
/**
 * AddToLibraryService
 * 
 * Unified service for adding artists/albums to the library.
 * Coordinates Plex checks, discography lookup, and downloads.
 */

import { createLogger } from '../lib/logger.js';
import { PlexService } from './plex.js';
import { DiscographyService } from './discography.js';
import { DownloadOrchestratorService } from './download-orchestrator.js';
import type {
  AddArtistRequest,
  AddAlbumRequest,
  AddResult,
} from './add-to-library.types.js';

const log = createLogger('AddToLibrary');

export interface AddToLibraryConfig {
  plex?: PlexService;
  discography?: DiscographyService;
  orchestrator?: DownloadOrchestratorService;
}

export class AddToLibraryService {
  private plex?: PlexService;
  private discography?: DiscographyService;
  private orchestrator?: DownloadOrchestratorService;

  constructor(config: AddToLibraryConfig) {
    this.plex = config.plex;
    this.discography = config.discography;
    this.orchestrator = config.orchestrator;
  }

  async addArtist(request: AddArtistRequest): Promise<AddResult> {
    log.info(`Adding artist: ${request.artistName}`);

    // Step 1: Check if already in Plex
    if (this.plex) {
      const exists = await this.plex.artistExists(request.artistName);
      if (exists) {
        log.info(`Artist already in library: ${request.artistName}`);
        return { success: true, alreadyExists: true };
      }
    }

    // Step 2: Get discography
    if (!this.discography) {
      return { success: false, error: 'Discography service not configured' };
    }

    const discographyResult = await this.discography.getArtistAlbums(
      request.artistName,
      request.artistId
    );

    if (!discographyResult.success) {
      return { success: false, error: 'Failed to fetch discography' };
    }

    const albums = discographyResult.albums || [];
    log.info(`Found ${albums.length} albums for ${request.artistName}`);

    // Step 3: Filter albums based on monitor type
    const albumsToDownload = this.filterAlbumsByMonitorType(
      albums,
      request.monitorType || 'all'
    );

    // Step 4: Check which albums are missing from Plex
    const missingAlbums = [];
    for (const album of albumsToDownload) {
      const inLibrary = this.plex
        ? await this.plex.albumExists(request.artistName, album.title)
        : false;
      
      if (!inLibrary) {
        missingAlbums.push(album);
      }
    }

    log.info(`${missingAlbums.length} albums missing from library`);

    // Step 5: Queue downloads (if autoDownload enabled)
    const downloadJobIds: string[] = [];
    
    if (request.autoDownload && this.orchestrator) {
      for (const album of missingAlbums) {
        try {
          const result = await this.orchestrator.searchAndGrabBest({
            artist: request.artistName,
            album: album.title,
            year: album.year,
            preferredFormat: request.qualityPreference,
          });

          if (result.success && result.downloadId) {
            downloadJobIds.push(result.downloadId);
          }
        } catch (e) {
          log.warn(`Failed to queue download for ${album.title}: ${e}`);
        }
      }
    }

    return {
      success: true,
      artistAdded: true,
      albumsQueued: downloadJobIds.length,
      downloadJobIds,
    };
  }

  async addAlbum(request: AddAlbumRequest): Promise<AddResult> {
    log.info(`Adding album: ${request.artistName} - ${request.albumName}`);

    // Check if already in Plex
    if (this.plex) {
      const exists = await this.plex.albumExists(
        request.artistName,
        request.albumName
      );
      if (exists) {
        return { success: true, alreadyExists: true };
      }
    }

    // Search and grab
    if (!this.orchestrator) {
      return { success: false, error: 'Download orchestrator not configured' };
    }

    const result = await this.orchestrator.searchAndGrabBest({
      artist: request.artistName,
      album: request.albumName,
      year: request.year,
      preferredFormat: request.qualityPreference,
    });

    if (result.success) {
      return {
        success: true,
        albumsQueued: 1,
        downloadJobIds: result.downloadId ? [result.downloadId] : [],
      };
    }

    return { success: false, error: result.error };
  }

  private filterAlbumsByMonitorType(
    albums: Array<{ title: string; year?: number }>,
    monitorType: string
  ): Array<{ title: string; year?: number }> {
    const sorted = [...albums].sort((a, b) => (b.year || 0) - (a.year || 0));
    const currentYear = new Date().getFullYear();

    switch (monitorType) {
      case 'all':
        return sorted;
      case 'future':
        return sorted.filter(a => (a.year || 0) >= currentYear);
      case 'existing':
        return sorted.filter(a => (a.year || 0) < currentYear);
      case 'first':
        return sorted.slice(-1);
      case 'latest':
        return sorted.slice(0, 1);
      case 'none':
        return [];
      default:
        return sorted;
    }
  }
}

export * from './add-to-library.types.js';
```

**Step 5: Run test to verify it passes**

**Step 6: Commit**

```bash
git add apps/api/src/services/add-to-library.ts apps/api/src/services/add-to-library.types.ts apps/api/tests/services/add-to-library.test.ts
git commit -m "feat(library): add AddToLibraryService for unified add flow"
```

---

## Task 2: Update Discovery Service

**Files:**
- Modify: `apps/api/src/services/discovery.ts`
- Modify: `apps/api/tests/services/discovery.test.ts`

**Current Behavior:**
```typescript
// Currently adds directly to Lidarr
await lidarrService.addArtist(artistId, {
  monitored: true,
  qualityProfileId: settings.qualityProfileId,
});
```

**New Behavior:**
```typescript
// Use AddToLibraryService instead
await addToLibraryService.addArtist({
  artistName: artist.name,
  artistId: artist.musicBrainzId,
  source: 'musicbrainz',
  monitorType: settings.monitorType,
  qualityPreference: settings.qualityPreference,
  autoDownload: settings.autoDownload,
});
```

**Step 1: Write failing test**

```typescript
describe('Discovery with Plex-centric flow', () => {
  it('should use AddToLibraryService instead of Lidarr', async () => {
    const mockAddToLibrary = {
      addArtist: vi.fn().mockResolvedValue({ success: true, albumsQueued: 3 }),
    };

    const discovery = new DiscoveryService({
      addToLibrary: mockAddToLibrary as any,
      // ... other deps
    });

    await discovery.discoverAndAdd('Pink Floyd');

    expect(mockAddToLibrary.addArtist).toHaveBeenCalledWith(
      expect.objectContaining({
        artistName: 'Pink Floyd',
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Update discovery.ts to use AddToLibraryService**

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/discovery.ts apps/api/tests/services/discovery.test.ts
git commit -m "refactor(discovery): use AddToLibraryService instead of Lidarr"
```

---

## Task 3: Update Subscriptions

**Files:**
- Modify: `apps/api/src/jobs/subscription-runner.ts`
- Modify: `apps/api/tests/jobs/subscription-runner.test.ts`

**Current Behavior:**
When a subscription triggers (new releases detected), it adds to Lidarr.

**New Behavior:**
Use AddToLibraryService.addAlbum() for each new release.

**Step 1: Write failing test**

```typescript
describe('SubscriptionRunner with Plex-centric flow', () => {
  it('should queue downloads for new releases via AddToLibrary', async () => {
    const mockAddToLibrary = {
      addAlbum: vi.fn().mockResolvedValue({ success: true, albumsQueued: 1 }),
    };

    const runner = new SubscriptionRunner({
      addToLibrary: mockAddToLibrary as any,
      // ... other deps
    });

    await runner.processNewRelease({
      artist: 'Radiohead',
      album: 'Kid A Mnesia',
      year: 2021,
    });

    expect(mockAddToLibrary.addAlbum).toHaveBeenCalledWith({
      artistName: 'Radiohead',
      albumName: 'Kid A Mnesia',
      year: 2021,
    });
  });
});
```

**Step 2-5: Same TDD cycle**

---

## Task 4: Add API Routes for Manual Add

**Files:**
- Create: `apps/api/src/routes/library.ts`
- Create: `apps/api/tests/api/library.test.ts`

**Step 1: Write failing test**

```typescript
describe('POST /api/library/artist', () => {
  it('should add artist via AddToLibraryService', async () => {
    const response = await request(app)
      .post('/api/library/artist')
      .send({
        artistName: 'Pink Floyd',
        monitorType: 'all',
        autoDownload: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

describe('POST /api/library/album', () => {
  it('should add album via AddToLibraryService', async () => {
    const response = await request(app)
      .post('/api/library/album')
      .send({
        artistName: 'Pink Floyd',
        albumName: 'The Wall',
        year: 1979,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
```

**Step 2: Implement routes**

```typescript
// apps/api/src/routes/library.ts
import { Router } from 'express';
import { z } from 'zod';
import { AddToLibraryService } from '../services/add-to-library.js';

const router = Router();

const addArtistSchema = z.object({
  artistName: z.string().min(1),
  artistId: z.string().optional(),
  source: z.enum(['spotify', 'musicbrainz', 'lastfm', 'discogs']).optional(),
  monitorType: z.enum(['all', 'future', 'existing', 'first', 'latest', 'none']).optional(),
  qualityPreference: z.enum(['flac', 'mp3', 'any']).optional(),
  autoDownload: z.boolean().optional(),
});

const addAlbumSchema = z.object({
  artistName: z.string().min(1),
  albumName: z.string().min(1),
  year: z.number().optional(),
  artistId: z.string().optional(),
  albumId: z.string().optional(),
  qualityPreference: z.enum(['flac', 'mp3', 'any']).optional(),
});

router.post('/artist', async (req, res) => {
  try {
    const data = addArtistSchema.parse(req.body);
    const service = req.app.get('addToLibrary') as AddToLibraryService;
    const result = await service.addArtist(data);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
    } else {
      res.status(500).json({ error: 'Failed to add artist' });
    }
  }
});

router.post('/album', async (req, res) => {
  try {
    const data = addAlbumSchema.parse(req.body);
    const service = req.app.get('addToLibrary') as AddToLibraryService;
    const result = await service.addAlbum(data);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
    } else {
      res.status(500).json({ error: 'Failed to add album' });
    }
  }
});

export default router;
```

**Step 3: Commit**

```bash
git add apps/api/src/routes/library.ts apps/api/tests/api/library.test.ts
git commit -m "feat(api): add /api/library routes for artist/album add"
```

---

## Task 5: Lidarr Fallback (Optional Add-Back)

**Files:**
- Modify: `apps/api/src/services/post-processor.ts`

After files are moved to the library successfully, optionally add to Lidarr for it to manage metadata/monitoring:

```typescript
async process(download: CompletedDownload): Promise<ProcessingResult> {
  // ... existing move logic ...
  
  // Optional: Add to Lidarr after files exist
  // Lidarr handles existing files much better than adding from scratch
  if (this.lidarr && this.config.addToLidarrAfterDownload) {
    try {
      await this.lidarr.addArtist(download.artist, {
        path: destinationPath,
        monitored: false,  // Don't let Lidarr search
      });
      log.info(`Added to Lidarr for metadata management: ${download.artist}`);
    } catch (e) {
      log.warn(`Failed to add to Lidarr (non-fatal): ${e}`);
    }
  }
}
```

---

## Task 6: Feature Flag for New vs Old Flow

**Files:**
- Create: `apps/api/src/lib/feature-flags.ts`
- Modify: `apps/api/src/services/discovery.ts`
- Modify: `apps/api/src/jobs/subscription-runner.ts`

Allow gradual rollout by checking a feature flag:

```typescript
// apps/api/src/lib/feature-flags.ts
export const featureFlags = {
  usePlexCentricFlow: process.env.USE_PLEX_CENTRIC_FLOW === 'true',
};

// In discovery.ts
if (featureFlags.usePlexCentricFlow) {
  await this.addToLibrary.addArtist({ ... });
} else {
  await this.lidarr.addArtist(artistId, { ... });
}
```

---

## Tasks 7-12: Remaining Automation

- **Task 7**: Background job for periodic Plex library sync
- **Task 8**: Notification webhooks (Discord, email) for add events
- **Task 9**: Rate limiting for bulk adds (don't DDoS Plex/Prowlarr)
- **Task 10**: Add retry logic for failed downloads in subscription flow
- **Task 11**: Add metrics/logging for new flow (success rate, source usage)
- **Task 12**: Integration tests for full Discovery → Download → Plex flow

---

## Summary

After Phase 6, the full Plex-centric flow is:

```
┌─────────────────────────────────────────────────────────────────┐
│ User Action or Subscription Trigger                             │
│ "Add Pink Floyd to library"                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ AddToLibraryService.addArtist()                                 │
│                                                                 │
│ 1. Check Plex → Artist exists? → Return "already in library"   │
│ 2. Get discography from Lidarr/Spotify/MusicBrainz/Discogs     │
│ 3. For each album, check Plex → Album exists?                  │
│ 4. Queue missing albums via DownloadOrchestrator               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ DownloadOrchestratorService.searchAndGrabBest()                 │
│                                                                 │
│ 1. Search Prowlarr + slskd in parallel                         │
│ 2. Score results (format, size, source reliability)            │
│ 3. Grab best result → SABnzbd or slskd                         │
│ 4. Create DownloadJob in database                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Download completes (webhook or polling)                         │
│                                                                 │
│ PostProcessorService.process()                                  │
│ 1. Translate paths (container path mapping)                    │
│ 2. Move files to /music/Artist/Album (Year)/                   │
│ 3. Trigger Plex partial library scan                           │
│ 4. (Optional) Add to Lidarr for metadata management            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Done! Album appears in Plex/Plexamp                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Next Steps After Implementation

1. **Enable feature flag** in staging environment
2. **Test end-to-end** with a few artists
3. **Monitor** download success rate vs old Lidarr flow
4. **Iterate** on scoring algorithm based on real results
5. **Document** new connection setup for users
6. **Roll out** to production when stable
