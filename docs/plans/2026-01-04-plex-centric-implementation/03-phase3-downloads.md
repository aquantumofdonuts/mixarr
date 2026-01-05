# Phase 3: Download Orchestration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create unified download system that searches Prowlarr and slskd in parallel, scores results, and manages downloads.

---

## Task 1: Create Download Types

**Files:**
- Create: `apps/api/src/services/download-orchestrator.types.ts`

**Step 1: Create types file**

```typescript
// apps/api/src/services/download-orchestrator.types.ts
/**
 * Types for unified download orchestration.
 */

export type DownloadSource = 'usenet' | 'soulseek';

export interface DownloadSearchResult {
  id: string;                    // Unique identifier
  title: string;                 // Release title
  artist: string;                // Extracted/matched artist
  album: string;                 // Extracted/matched album
  source: DownloadSource;
  sourceId: string;              // Prowlarr GUID or slskd result ID
  
  // Quality info
  format?: 'flac' | 'mp3' | 'aac' | 'ogg' | 'unknown';
  bitrate?: number;              // For lossy formats
  sampleRate?: number;           // For lossless
  bitDepth?: number;             // 16, 24-bit
  size: number;                  // Bytes
  
  // Source-specific
  indexer?: string;              // Usenet indexer name
  uploader?: string;             // Soulseek username
  freeSlots?: number;            // Soulseek free upload slots
  
  // Scoring
  score: number;                 // 0-100 quality score
  
  // Download URL/info
  downloadUrl?: string;          // For usenet
  files?: Array<{                // For soulseek
    filename: string;
    size: number;
  }>;
}

export interface DownloadRequest {
  artist: string;
  album: string;
  year?: number;
  result: DownloadSearchResult;
}

export interface DownloadProgress {
  id: string;
  status: 'queued' | 'downloading' | 'processing' | 'complete' | 'failed';
  source: DownloadSource;
  artist: string;
  album: string;
  percentage?: number;
  eta?: string;
  path?: string;
  error?: string;
}

export interface SearchOptions {
  artist: string;
  album: string;
  year?: number;
  preferredFormat?: 'flac' | 'mp3' | 'any';
  searchUsenet?: boolean;
  searchSoulseek?: boolean;
  timeout?: number;
}
```

**Step 2: Commit**

```bash
git add apps/api/src/services/download-orchestrator.types.ts
git commit -m "feat(download): add download orchestrator types"
```

---

## Task 2: Create Download Orchestrator - Base

**Files:**
- Create: `apps/api/src/services/download-orchestrator.ts`
- Create: `apps/api/tests/services/download-orchestrator.test.ts`

**Step 1: Write failing test**

```typescript
// apps/api/tests/services/download-orchestrator.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('Download Orchestrator', () => {
  describe('constructor', () => {
    it('should create orchestrator with services', async () => {
      const { DownloadOrchestratorService } = await import(
        '../../src/services/download-orchestrator.js'
      );
      
      const orchestrator = new DownloadOrchestratorService({});

      expect(orchestrator).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Create DownloadOrchestratorService base**

```typescript
// apps/api/src/services/download-orchestrator.ts
/**
 * Download Orchestrator Service
 * 
 * Coordinates download searches across Prowlarr and slskd,
 * scores results, and manages download lifecycle.
 */

import { createLogger } from '../lib/logger.js';
import { ProwlarrService } from './prowlarr.js';
import { SabnzbdService } from './sabnzbd.js';
import { SlskdService } from './slskd.js';
import type {
  DownloadSource,
  DownloadSearchResult,
  DownloadRequest,
  DownloadProgress,
  SearchOptions,
} from './download-orchestrator.types.js';

const log = createLogger('DownloadOrchestrator');

export interface DownloadOrchestratorConfig {
  prowlarr?: ProwlarrService;
  sabnzbd?: SabnzbdService;
  slskd?: SlskdService;
}

export class DownloadOrchestratorService {
  private prowlarr?: ProwlarrService;
  private sabnzbd?: SabnzbdService;
  private slskd?: SlskdService;

  constructor(config: DownloadOrchestratorConfig) {
    this.prowlarr = config.prowlarr;
    this.sabnzbd = config.sabnzbd;
    this.slskd = config.slskd;
  }

  hasUsenetSupport(): boolean {
    return !!(this.prowlarr && this.sabnzbd);
  }

  hasSoulseekSupport(): boolean {
    return !!this.slskd;
  }
}

export * from './download-orchestrator.types.js';
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/download-orchestrator.ts apps/api/tests/services/download-orchestrator.test.ts
git commit -m "feat(download): add DownloadOrchestratorService base"
```

---

## Task 3: Parallel Search Implementation

**Files:**
- Modify: `apps/api/src/services/download-orchestrator.ts`
- Modify: `apps/api/tests/services/download-orchestrator.test.ts`

**Step 1: Write failing test**

```typescript
describe('search', () => {
  it('should search both sources in parallel', async () => {
    const { DownloadOrchestratorService } = await import(
      '../../src/services/download-orchestrator.js'
    );
    
    const mockProwlarr = {
      search: vi.fn().mockResolvedValue([
        {
          guid: 'prowlarr-1',
          title: 'Pink Floyd - The Dark Side of the Moon (1973) [FLAC]',
          indexer: 'NZBgeek',
          size: 892000000,
          downloadUrl: 'https://example.com/nzb/1',
        },
      ]),
    };
    
    const mockSlskd = {
      search: vi.fn().mockResolvedValue([
        {
          username: 'user123',
          files: [
            { filename: '01 - Speak to Me.flac', size: 50000000 },
            { filename: '02 - Breathe.flac', size: 60000000 },
          ],
          freeUploadSlots: 5,
          uploadSpeed: 1000000,
        },
      ]),
    };

    const orchestrator = new DownloadOrchestratorService({
      prowlarr: mockProwlarr as any,
      slskd: mockSlskd as any,
    });

    const results = await orchestrator.search({
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
    });

    expect(mockProwlarr.search).toHaveBeenCalled();
    expect(mockSlskd.search).toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
  });

  it('should continue if one source fails', async () => {
    const { DownloadOrchestratorService } = await import(
      '../../src/services/download-orchestrator.js'
    );
    
    const mockProwlarr = {
      search: vi.fn().mockRejectedValue(new Error('Prowlarr unavailable')),
    };
    
    const mockSlskd = {
      search: vi.fn().mockResolvedValue([
        {
          username: 'user123',
          files: [{ filename: 'song.flac', size: 50000000 }],
          freeUploadSlots: 5,
        },
      ]),
    };

    const orchestrator = new DownloadOrchestratorService({
      prowlarr: mockProwlarr as any,
      slskd: mockSlskd as any,
    });

    const results = await orchestrator.search({
      artist: 'Pink Floyd',
      album: 'DSOTM',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('soulseek');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement search**

```typescript
async search(options: SearchOptions): Promise<DownloadSearchResult[]> {
  const searchQuery = `${options.artist} ${options.album}`;
  const results: DownloadSearchResult[] = [];
  const errors: string[] = [];

  // Build list of search promises
  const searches: Promise<void>[] = [];

  // Usenet search (via Prowlarr)
  if (this.prowlarr && options.searchUsenet !== false) {
    searches.push(
      this.searchUsenet(searchQuery, options)
        .then(r => results.push(...r))
        .catch(e => {
          errors.push(`Usenet: ${e.message}`);
          log.warn(`Usenet search failed: ${e.message}`);
        })
    );
  }

  // Soulseek search (via slskd)
  if (this.slskd && options.searchSoulseek !== false) {
    searches.push(
      this.searchSoulseek(searchQuery, options)
        .then(r => results.push(...r))
        .catch(e => {
          errors.push(`Soulseek: ${e.message}`);
          log.warn(`Soulseek search failed: ${e.message}`);
        })
    );
  }

  // Wait for all searches with timeout
  const timeout = options.timeout || 30000;
  await Promise.race([
    Promise.all(searches),
    new Promise(resolve => setTimeout(resolve, timeout)),
  ]);

  // Score and sort results
  const scored = results.map(r => ({
    ...r,
    score: this.calculateScore(r, options),
  }));

  scored.sort((a, b) => b.score - a.score);

  log.info(`Search complete: ${scored.length} results for "${searchQuery}"`);
  return scored;
}

private async searchUsenet(
  query: string,
  options: SearchOptions
): Promise<DownloadSearchResult[]> {
  if (!this.prowlarr) return [];

  const results = await this.prowlarr.search(query, { musicOnly: true });

  return results.map(r => ({
    id: `usenet-${r.guid}`,
    title: r.title,
    artist: options.artist,
    album: options.album,
    source: 'usenet' as DownloadSource,
    sourceId: r.guid,
    format: this.extractFormat(r.title),
    size: r.size,
    indexer: r.indexer,
    score: 0, // Will be calculated later
    downloadUrl: r.downloadUrl,
  }));
}

private async searchSoulseek(
  query: string,
  options: SearchOptions
): Promise<DownloadSearchResult[]> {
  if (!this.slskd) return [];

  const results = await this.slskd.search(query);
  const aggregated: DownloadSearchResult[] = [];

  for (const result of results) {
    // Group files by apparent album (same directory)
    const audioFiles = result.files.filter(f => 
      /\.(flac|mp3|m4a|ogg|wav)$/i.test(f.filename)
    );

    if (audioFiles.length === 0) continue;

    const totalSize = audioFiles.reduce((sum, f) => sum + f.size, 0);

    aggregated.push({
      id: `slskd-${result.username}-${Date.now()}`,
      title: audioFiles[0].filename,
      artist: options.artist,
      album: options.album,
      source: 'soulseek' as DownloadSource,
      sourceId: result.username,
      format: this.extractFormatFromFiles(audioFiles),
      size: totalSize,
      uploader: result.username,
      freeSlots: result.freeUploadSlots,
      score: 0,
      files: audioFiles,
    });
  }

  return aggregated;
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/download-orchestrator.ts apps/api/tests/services/download-orchestrator.test.ts
git commit -m "feat(download): add parallel search implementation"
```

---

## Task 4: Result Scoring Algorithm

**Files:**
- Modify: `apps/api/src/services/download-orchestrator.ts`
- Modify: `apps/api/tests/services/download-orchestrator.test.ts`

**Step 1: Write failing test**

```typescript
describe('scoring', () => {
  it('should score FLAC higher than MP3', async () => {
    const { DownloadOrchestratorService } = await import(
      '../../src/services/download-orchestrator.js'
    );

    const orchestrator = new DownloadOrchestratorService({});

    const flacResult = {
      id: '1',
      title: 'Album [FLAC]',
      format: 'flac' as const,
      size: 500000000,
      source: 'usenet' as const,
    };

    const mp3Result = {
      id: '2',
      title: 'Album [MP3 320]',
      format: 'mp3' as const,
      bitrate: 320,
      size: 100000000,
      source: 'usenet' as const,
    };

    const flacScore = (orchestrator as any).calculateScore(flacResult, {});
    const mp3Score = (orchestrator as any).calculateScore(mp3Result, {});

    expect(flacScore).toBeGreaterThan(mp3Score);
  });

  it('should score usenet higher than soulseek by default', async () => {
    const { DownloadOrchestratorService } = await import(
      '../../src/services/download-orchestrator.js'
    );

    const orchestrator = new DownloadOrchestratorService({});

    const usenetResult = {
      id: '1',
      format: 'flac' as const,
      size: 500000000,
      source: 'usenet' as const,
    };

    const soulseekResult = {
      id: '2',
      format: 'flac' as const,
      size: 500000000,
      source: 'soulseek' as const,
      freeSlots: 5,
    };

    const usenetScore = (orchestrator as any).calculateScore(usenetResult, {});
    const soulseekScore = (orchestrator as any).calculateScore(soulseekResult, {});

    expect(usenetScore).toBeGreaterThan(soulseekScore);
  });

  it('should penalize suspiciously small files', async () => {
    const { DownloadOrchestratorService } = await import(
      '../../src/services/download-orchestrator.js'
    );

    const orchestrator = new DownloadOrchestratorService({});

    const normalResult = {
      id: '1',
      format: 'flac' as const,
      size: 500000000, // 500MB - reasonable for FLAC album
      source: 'usenet' as const,
    };

    const tinyResult = {
      id: '2',
      format: 'flac' as const,
      size: 10000000, // 10MB - way too small for FLAC album
      source: 'usenet' as const,
    };

    const normalScore = (orchestrator as any).calculateScore(normalResult, {});
    const tinyScore = (orchestrator as any).calculateScore(tinyResult, {});

    expect(normalScore).toBeGreaterThan(tinyScore);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement calculateScore**

```typescript
private calculateScore(
  result: Partial<DownloadSearchResult>,
  options: SearchOptions
): number {
  let score = 50; // Base score

  // Format scoring (max +30)
  switch (result.format) {
    case 'flac':
      score += 30;
      break;
    case 'mp3':
      score += result.bitrate === 320 ? 20 : (result.bitrate === 256 ? 15 : 10);
      break;
    case 'aac':
    case 'ogg':
      score += 15;
      break;
    default:
      score += 5;
  }

  // Preferred format bonus
  if (options.preferredFormat === result.format) {
    score += 10;
  }

  // Source reliability (+10 for usenet, +5 for soulseek)
  if (result.source === 'usenet') {
    score += 10;
  } else if (result.source === 'soulseek') {
    score += 5;
    // Bonus for users with free slots
    if (result.freeSlots && result.freeSlots > 0) {
      score += Math.min(result.freeSlots, 5); // Up to +5 for available slots
    }
  }

  // Size sanity check
  const sizeInMB = (result.size || 0) / (1024 * 1024);
  if (result.format === 'flac') {
    // FLAC albums should be at least 200MB, typically 400-800MB
    if (sizeInMB < 100) {
      score -= 30; // Suspiciously small
    } else if (sizeInMB < 200) {
      score -= 15; // Probably incomplete
    } else if (sizeInMB > 300) {
      score += 5; // Reasonable size
    }
  } else if (result.format === 'mp3') {
    // MP3 albums typically 80-200MB at 320kbps
    if (sizeInMB < 30) {
      score -= 30;
    } else if (sizeInMB < 60) {
      score -= 10;
    }
  }

  // Clamp score to 0-100
  return Math.max(0, Math.min(100, score));
}

private extractFormat(title: string): DownloadSearchResult['format'] {
  const lower = title.toLowerCase();
  if (lower.includes('flac')) return 'flac';
  if (lower.includes('mp3')) return 'mp3';
  if (lower.includes('aac') || lower.includes('m4a')) return 'aac';
  if (lower.includes('ogg')) return 'ogg';
  return 'unknown';
}

private extractFormatFromFiles(
  files: Array<{ filename: string }>
): DownloadSearchResult['format'] {
  const first = files[0]?.filename.toLowerCase() || '';
  if (first.endsWith('.flac')) return 'flac';
  if (first.endsWith('.mp3')) return 'mp3';
  if (first.endsWith('.m4a')) return 'aac';
  if (first.endsWith('.ogg')) return 'ogg';
  return 'unknown';
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/download-orchestrator.ts apps/api/tests/services/download-orchestrator.test.ts
git commit -m "feat(download): add result scoring algorithm"
```

---

## Task 5: Download Initiation

**Files:**
- Modify: `apps/api/src/services/download-orchestrator.ts`
- Modify: `apps/api/tests/services/download-orchestrator.test.ts`

**Step 1: Write failing test**

```typescript
describe('download', () => {
  it('should initiate usenet download via SABnzbd', async () => {
    const { DownloadOrchestratorService } = await import(
      '../../src/services/download-orchestrator.js'
    );
    
    const mockSabnzbd = {
      addByUrl: vi.fn().mockResolvedValue({
        success: true,
        nzoId: 'sab-nzo-123',
      }),
    };

    const orchestrator = new DownloadOrchestratorService({
      sabnzbd: mockSabnzbd as any,
    });

    const result = await orchestrator.download({
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
      year: 1973,
      result: {
        id: 'usenet-1',
        source: 'usenet',
        sourceId: 'guid-123',
        downloadUrl: 'https://example.com/nzb/123',
        title: 'Pink Floyd - DSOTM',
        artist: 'Pink Floyd',
        album: 'The Dark Side of the Moon',
        size: 500000000,
        score: 85,
      },
    });

    expect(mockSabnzbd.addByUrl).toHaveBeenCalledWith(
      'https://example.com/nzb/123',
      expect.any(String)
    );
    expect(result.success).toBe(true);
    expect(result.downloadId).toBe('sab-nzo-123');
  });

  it('should initiate soulseek download via slskd', async () => {
    const { DownloadOrchestratorService } = await import(
      '../../src/services/download-orchestrator.js'
    );
    
    const mockSlskd = {
      downloadFiles: vi.fn().mockResolvedValue({
        success: true,
        id: 'slskd-dl-123',
      }),
    };

    const orchestrator = new DownloadOrchestratorService({
      slskd: mockSlskd as any,
    });

    const result = await orchestrator.download({
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
      result: {
        id: 'slskd-1',
        source: 'soulseek',
        sourceId: 'user123',
        uploader: 'user123',
        title: 'Pink Floyd - DSOTM',
        artist: 'Pink Floyd',
        album: 'The Dark Side of the Moon',
        size: 500000000,
        score: 80,
        files: [
          { filename: '01 - Track.flac', size: 50000000 },
        ],
      },
    });

    expect(mockSlskd.downloadFiles).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement download**

```typescript
async download(request: DownloadRequest): Promise<{
  success: boolean;
  downloadId?: string;
  error?: string;
}> {
  const { result } = request;
  const downloadName = `${request.artist} - ${request.album}${request.year ? ` (${request.year})` : ''}`;

  log.info(`Initiating ${result.source} download: ${downloadName}`);

  try {
    if (result.source === 'usenet') {
      return await this.downloadUsenet(result, downloadName);
    } else if (result.source === 'soulseek') {
      return await this.downloadSoulseek(result, downloadName);
    } else {
      return { success: false, error: `Unknown source: ${result.source}` };
    }
  } catch (error) {
    log.error(`Download failed: ${error}`);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Download failed',
    };
  }
}

private async downloadUsenet(
  result: DownloadSearchResult,
  name: string
): Promise<{ success: boolean; downloadId?: string; error?: string }> {
  if (!this.sabnzbd) {
    return { success: false, error: 'SABnzbd not configured' };
  }

  if (!result.downloadUrl) {
    return { success: false, error: 'No download URL provided' };
  }

  const response = await this.sabnzbd.addByUrl(result.downloadUrl, name);
  
  if (response.success && response.nzoId) {
    return { success: true, downloadId: response.nzoId };
  }
  
  return { success: false, error: response.error || 'Failed to add to SABnzbd' };
}

private async downloadSoulseek(
  result: DownloadSearchResult,
  _name: string
): Promise<{ success: boolean; downloadId?: string; error?: string }> {
  if (!this.slskd) {
    return { success: false, error: 'slskd not configured' };
  }

  if (!result.files || !result.uploader) {
    return { success: false, error: 'No files or uploader specified' };
  }

  const response = await this.slskd.downloadFiles(result.uploader, result.files);
  
  if (response.success) {
    return { success: true, downloadId: response.id };
  }
  
  return { success: false, error: 'Failed to queue slskd download' };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/download-orchestrator.ts apps/api/tests/services/download-orchestrator.test.ts
git commit -m "feat(download): add download initiation for usenet and soulseek"
```

---

## Task 6: Download Status Tracking

**Files:**
- Modify: `apps/api/src/services/download-orchestrator.ts`
- Modify: `apps/api/tests/services/download-orchestrator.test.ts`

**Step 1: Write failing test**

```typescript
describe('getStatus', () => {
  it('should get usenet download status from SABnzbd', async () => {
    const { DownloadOrchestratorService } = await import(
      '../../src/services/download-orchestrator.js'
    );
    
    const mockSabnzbd = {
      getItemStatus: vi.fn().mockResolvedValue({
        found: true,
        status: 'downloading',
        percentage: 45,
      }),
    };

    const orchestrator = new DownloadOrchestratorService({
      sabnzbd: mockSabnzbd as any,
    });

    const status = await orchestrator.getStatus('sab-nzo-123', 'usenet');

    expect(status.status).toBe('downloading');
    expect(status.percentage).toBe(45);
  });

  it('should get soulseek download status from slskd', async () => {
    const { DownloadOrchestratorService } = await import(
      '../../src/services/download-orchestrator.js'
    );
    
    const mockSlskd = {
      getDownloadStatus: vi.fn().mockResolvedValue({
        found: true,
        state: 'Completed',
        path: '/downloads/slskd/Pink Floyd',
      }),
    };

    const orchestrator = new DownloadOrchestratorService({
      slskd: mockSlskd as any,
    });

    const status = await orchestrator.getStatus('slskd-123', 'soulseek');

    expect(status.status).toBe('complete');
    expect(status.path).toContain('Pink Floyd');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement getStatus**

```typescript
async getStatus(
  downloadId: string,
  source: DownloadSource
): Promise<DownloadProgress> {
  if (source === 'usenet') {
    return this.getUsenetStatus(downloadId);
  } else if (source === 'soulseek') {
    return this.getSoulseekStatus(downloadId);
  }
  
  return {
    id: downloadId,
    status: 'failed',
    source,
    artist: '',
    album: '',
    error: `Unknown source: ${source}`,
  };
}

private async getUsenetStatus(downloadId: string): Promise<DownloadProgress> {
  if (!this.sabnzbd) {
    return {
      id: downloadId,
      status: 'failed',
      source: 'usenet',
      artist: '',
      album: '',
      error: 'SABnzbd not configured',
    };
  }

  const status = await this.sabnzbd.getItemStatus(downloadId);
  
  if (!status.found) {
    return {
      id: downloadId,
      status: 'failed',
      source: 'usenet',
      artist: '',
      album: '',
      error: 'Download not found',
    };
  }

  return {
    id: downloadId,
    status: status.status === 'completed' ? 'complete' 
          : status.status === 'failed' ? 'failed'
          : status.status === 'downloading' ? 'downloading'
          : 'queued',
    source: 'usenet',
    artist: '',
    album: '',
    percentage: status.percentage,
    path: status.path,
  };
}

private async getSoulseekStatus(downloadId: string): Promise<DownloadProgress> {
  if (!this.slskd) {
    return {
      id: downloadId,
      status: 'failed',
      source: 'soulseek',
      artist: '',
      album: '',
      error: 'slskd not configured',
    };
  }

  const status = await this.slskd.getDownloadStatus(downloadId);
  
  if (!status.found) {
    return {
      id: downloadId,
      status: 'failed',
      source: 'soulseek',
      artist: '',
      album: '',
      error: 'Download not found',
    };
  }

  const stateMap: Record<string, DownloadProgress['status']> = {
    'Requested': 'queued',
    'Queued': 'queued',
    'Downloading': 'downloading',
    'Completed': 'complete',
    'Errored': 'failed',
  };

  return {
    id: downloadId,
    status: stateMap[status.state] || 'queued',
    source: 'soulseek',
    artist: '',
    album: '',
    percentage: status.percentComplete,
    path: status.path,
  };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/download-orchestrator.ts apps/api/tests/services/download-orchestrator.test.ts
git commit -m "feat(download): add download status tracking"
```

---

## Tasks 7-15: Remaining Download Orchestration

- **Task 7**: Add auto-grab best result method
- **Task 8**: Add retry logic for failed downloads
- **Task 9**: Create download routes (`POST /api/downloads/search`, `POST /api/downloads/grab`)
- **Task 10**: Add download job persistence to database
- **Task 11**: Add webhook handler for SABnzbd completion
- **Task 12**: Add polling job for slskd completion
- **Task 13**: Add download queue management (priority, limits)
- **Task 14**: Add download history and logging
- **Task 15**: Integration tests for full download flow

---

See [04-phase4-postprocessing.md](04-phase4-postprocessing.md) for Phase 4.
