# Phase 4: Post-Processing

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move completed downloads to the correct location, handle path mapping between containers, and trigger Plex library scans.

---

## Task 1: Create Post-Processor Types

**Files:**
- Create: `apps/api/src/services/post-processor.types.ts`

**Step 1: Create types file**

```typescript
// apps/api/src/services/post-processor.types.ts
/**
 * Types for post-processing completed downloads.
 */

export interface CompletedDownload {
  downloadId: string;
  source: 'usenet' | 'soulseek';
  artist: string;
  album: string;
  year?: number;
  sourcePath: string;       // Path where files currently exist
  files: DownloadedFile[];
}

export interface DownloadedFile {
  filename: string;
  size: number;
  extension: string;
}

export interface ProcessingResult {
  success: boolean;
  destinationPath?: string;   // Final path after move
  filesProcessed?: number;
  error?: string;
}

export interface PathMapping {
  remotePath: string;         // Path as seen by the service (SABnzbd, slskd)
  localPath: string;          // Path as seen by Mixarr API
}

export interface PostProcessorConfig {
  musicLibraryPath: string;   // Base path for organized music (e.g., /music)
  pathMappings: PathMapping[];
  cleanupSource?: boolean;    // Delete source folder after move
}
```

**Step 2: Commit**

```bash
git add apps/api/src/services/post-processor.types.ts
git commit -m "feat(postproc): add post-processor types"
```

---

## Task 2: Create Post-Processor Service - Base

**Files:**
- Create: `apps/api/src/services/post-processor.ts`
- Create: `apps/api/tests/services/post-processor.test.ts`

**Step 1: Write failing test**

```typescript
// apps/api/tests/services/post-processor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('Post-Processor Service', () => {
  describe('constructor', () => {
    it('should create service with config', async () => {
      const { PostProcessorService } = await import(
        '../../src/services/post-processor.js'
      );
      
      const processor = new PostProcessorService({
        musicLibraryPath: '/music',
        pathMappings: [],
      });

      expect(processor).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Create base service**

```typescript
// apps/api/src/services/post-processor.ts
/**
 * Post-Processor Service
 * 
 * Handles moving completed downloads to the music library,
 * path translation between containers, and triggering Plex scans.
 */

import { createLogger } from '../lib/logger.js';
import { PlexService } from './plex.js';
import type {
  CompletedDownload,
  ProcessingResult,
  PathMapping,
  PostProcessorConfig,
} from './post-processor.types.js';

const log = createLogger('PostProcessor');

export class PostProcessorService {
  private musicLibraryPath: string;
  private pathMappings: PathMapping[];
  private cleanupSource: boolean;
  private plex?: PlexService;

  constructor(config: PostProcessorConfig, plex?: PlexService) {
    this.musicLibraryPath = config.musicLibraryPath;
    this.pathMappings = config.pathMappings;
    this.cleanupSource = config.cleanupSource ?? true;
    this.plex = plex;
  }
}

export * from './post-processor.types.js';
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/post-processor.ts apps/api/tests/services/post-processor.test.ts
git commit -m "feat(postproc): add PostProcessorService base"
```

---

## Task 3: Path Translation

**Files:**
- Modify: `apps/api/src/services/post-processor.ts`
- Modify: `apps/api/tests/services/post-processor.test.ts`

**Step 1: Write failing test**

```typescript
describe('translatePath', () => {
  it('should translate remote path to local path', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const processor = new PostProcessorService({
      musicLibraryPath: '/music',
      pathMappings: [
        { remotePath: '/data/downloads', localPath: '/mnt/downloads' },
        { remotePath: '/data/music', localPath: '/mnt/music' },
      ],
    });

    const local = processor.translatePath('/data/downloads/album/song.flac');

    expect(local).toBe('/mnt/downloads/album/song.flac');
  });

  it('should return original path if no mapping matches', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const processor = new PostProcessorService({
      musicLibraryPath: '/music',
      pathMappings: [
        { remotePath: '/data/downloads', localPath: '/mnt/downloads' },
      ],
    });

    const local = processor.translatePath('/other/path/file.flac');

    expect(local).toBe('/other/path/file.flac');
  });

  it('should handle paths with trailing slashes', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const processor = new PostProcessorService({
      musicLibraryPath: '/music',
      pathMappings: [
        { remotePath: '/data/downloads/', localPath: '/mnt/downloads/' },
      ],
    });

    const local = processor.translatePath('/data/downloads/album');

    expect(local).toBe('/mnt/downloads/album');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement translatePath**

```typescript
/**
 * Translate a path from one container's view to another's.
 * Used when SABnzbd/slskd report paths that differ from Mixarr's view.
 */
translatePath(remotePath: string): string {
  for (const mapping of this.pathMappings) {
    const remote = mapping.remotePath.replace(/\/$/, '');
    const local = mapping.localPath.replace(/\/$/, '');
    
    if (remotePath.startsWith(remote)) {
      const translated = remotePath.replace(remote, local);
      log.debug(`Path translated: ${remotePath} -> ${translated}`);
      return translated;
    }
  }
  
  log.debug(`No path mapping for: ${remotePath}`);
  return remotePath;
}

/**
 * Reverse translate from local to remote (for sending paths to services).
 */
reverseTranslatePath(localPath: string): string {
  for (const mapping of this.pathMappings) {
    const remote = mapping.remotePath.replace(/\/$/, '');
    const local = mapping.localPath.replace(/\/$/, '');
    
    if (localPath.startsWith(local)) {
      return localPath.replace(local, remote);
    }
  }
  
  return localPath;
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/post-processor.ts apps/api/tests/services/post-processor.test.ts
git commit -m "feat(postproc): add path translation"
```

---

## Task 4: Destination Path Generation

**Files:**
- Modify: `apps/api/src/services/post-processor.ts`
- Modify: `apps/api/tests/services/post-processor.test.ts`

**Step 1: Write failing test**

```typescript
describe('generateDestinationPath', () => {
  it('should generate correct folder structure', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const processor = new PostProcessorService({
      musicLibraryPath: '/music',
      pathMappings: [],
    });

    const dest = processor.generateDestinationPath({
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
      year: 1973,
    });

    expect(dest).toBe('/music/Pink Floyd/The Dark Side of the Moon (1973)');
  });

  it('should sanitize special characters', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const processor = new PostProcessorService({
      musicLibraryPath: '/music',
      pathMappings: [],
    });

    const dest = processor.generateDestinationPath({
      artist: 'AC/DC',
      album: 'Back in Black: Special Edition',
      year: 1980,
    });

    // Forward slashes and colons are not valid in folder names
    expect(dest).toBe('/music/AC-DC/Back in Black - Special Edition (1980)');
  });

  it('should handle missing year', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const processor = new PostProcessorService({
      musicLibraryPath: '/music',
      pathMappings: [],
    });

    const dest = processor.generateDestinationPath({
      artist: 'Pink Floyd',
      album: 'Animals',
    });

    expect(dest).toBe('/music/Pink Floyd/Animals');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement generateDestinationPath**

```typescript
/**
 * Generate the destination path for an album.
 * Format: /music/Artist Name/Album Name (Year)
 */
generateDestinationPath(info: {
  artist: string;
  album: string;
  year?: number;
}): string {
  const sanitizedArtist = this.sanitizeFolderName(info.artist);
  const sanitizedAlbum = this.sanitizeFolderName(info.album);
  
  const albumFolder = info.year
    ? `${sanitizedAlbum} (${info.year})`
    : sanitizedAlbum;
    
  return `${this.musicLibraryPath}/${sanitizedArtist}/${albumFolder}`;
}

/**
 * Remove or replace characters that are invalid in folder names.
 */
private sanitizeFolderName(name: string): string {
  return name
    // Replace forward slashes with hyphens
    .replace(/\//g, '-')
    // Replace colons with hyphens
    .replace(/:/g, ' -')
    // Replace other invalid characters
    .replace(/[<>"|?*\\]/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    // Trim whitespace
    .trim();
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/post-processor.ts apps/api/tests/services/post-processor.test.ts
git commit -m "feat(postproc): add destination path generation"
```

---

## Task 5: File Moving

**Files:**
- Modify: `apps/api/src/services/post-processor.ts`
- Modify: `apps/api/tests/services/post-processor.test.ts`

**Step 1: Write failing test (with fs mocks)**

```typescript
import { vol } from 'memfs';

vi.mock('fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

describe('moveFiles', () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync('/downloads/album', { recursive: true });
    vol.writeFileSync('/downloads/album/01 - Track.flac', 'flac data');
    vol.writeFileSync('/downloads/album/02 - Track.flac', 'flac data');
    vol.mkdirSync('/music', { recursive: true });
  });

  it('should move audio files to destination', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const processor = new PostProcessorService({
      musicLibraryPath: '/music',
      pathMappings: [],
      cleanupSource: false,
    });

    const result = await processor.moveFiles(
      '/downloads/album',
      '/music/Pink Floyd/Animals (1977)'
    );

    expect(result.success).toBe(true);
    expect(result.filesProcessed).toBe(2);
    expect(vol.existsSync('/music/Pink Floyd/Animals (1977)/01 - Track.flac')).toBe(true);
  });

  it('should clean up source folder when configured', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const processor = new PostProcessorService({
      musicLibraryPath: '/music',
      pathMappings: [],
      cleanupSource: true,
    });

    await processor.moveFiles(
      '/downloads/album',
      '/music/Pink Floyd/Animals (1977)'
    );

    expect(vol.existsSync('/downloads/album')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement moveFiles**

```typescript
import { mkdir, readdir, rename, rm, stat } from 'fs/promises';
import { join, extname } from 'path';

private readonly audioExtensions = new Set([
  '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.ape',
]);

/**
 * Move audio files from source to destination.
 */
async moveFiles(sourcePath: string, destinationPath: string): Promise<{
  success: boolean;
  filesProcessed: number;
  error?: string;
}> {
  try {
    // Create destination directory
    await mkdir(destinationPath, { recursive: true });
    
    // Get list of files in source
    const files = await readdir(sourcePath);
    let filesProcessed = 0;

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      const sourceFile = join(sourcePath, file);
      const destFile = join(destinationPath, file);
      
      const fileStat = await stat(sourceFile);
      
      if (fileStat.isDirectory()) {
        // Recursively handle subdirectories (disc folders, etc.)
        const subResult = await this.moveFiles(sourceFile, join(destinationPath, file));
        filesProcessed += subResult.filesProcessed;
      } else if (this.audioExtensions.has(ext)) {
        // Move audio file
        await rename(sourceFile, destFile);
        filesProcessed++;
        log.debug(`Moved: ${file}`);
      }
      // Skip non-audio files (NFO, JPG, etc.) - let Plex handle artwork
    }

    // Clean up source if configured
    if (this.cleanupSource) {
      try {
        await rm(sourcePath, { recursive: true, force: true });
        log.debug(`Cleaned up source: ${sourcePath}`);
      } catch (e) {
        log.warn(`Failed to clean up source: ${e}`);
      }
    }

    log.info(`Moved ${filesProcessed} files to ${destinationPath}`);
    return { success: true, filesProcessed };
  } catch (error) {
    log.error(`Failed to move files: ${error}`);
    return {
      success: false,
      filesProcessed: 0,
      error: error instanceof Error ? error.message : 'Move failed',
    };
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/post-processor.ts apps/api/tests/services/post-processor.test.ts
git commit -m "feat(postproc): add file moving"
```

---

## Task 6: Process Completed Download (Full Flow)

**Files:**
- Modify: `apps/api/src/services/post-processor.ts`
- Modify: `apps/api/tests/services/post-processor.test.ts`

**Step 1: Write failing test**

```typescript
describe('process', () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync('/downloads/Pink_Floyd_DSOTM', { recursive: true });
    vol.writeFileSync('/downloads/Pink_Floyd_DSOTM/01 - Speak to Me.flac', 'data');
    vol.writeFileSync('/downloads/Pink_Floyd_DSOTM/02 - Breathe.flac', 'data');
    vol.mkdirSync('/music', { recursive: true });
  });

  it('should process complete download end-to-end', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const mockPlex = {
      scanLibrary: vi.fn().mockResolvedValue({ success: true }),
    };
    
    const processor = new PostProcessorService(
      {
        musicLibraryPath: '/music',
        pathMappings: [
          { remotePath: '/data/downloads', localPath: '/downloads' },
        ],
        cleanupSource: true,
      },
      mockPlex as any
    );

    const result = await processor.process({
      downloadId: 'dl-123',
      source: 'usenet',
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
      year: 1973,
      sourcePath: '/data/downloads/Pink_Floyd_DSOTM', // Remote path
      files: [
        { filename: '01 - Speak to Me.flac', size: 5000000, extension: '.flac' },
        { filename: '02 - Breathe.flac', size: 6000000, extension: '.flac' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filesProcessed).toBe(2);
    expect(result.destinationPath).toBe(
      '/music/Pink Floyd/The Dark Side of the Moon (1973)'
    );
    expect(mockPlex.scanLibrary).toHaveBeenCalled();
  });

  it('should still succeed if Plex scan fails', async () => {
    const { PostProcessorService } = await import(
      '../../src/services/post-processor.js'
    );
    
    const mockPlex = {
      scanLibrary: vi.fn().mockRejectedValue(new Error('Plex unavailable')),
    };
    
    const processor = new PostProcessorService(
      {
        musicLibraryPath: '/music',
        pathMappings: [],
        cleanupSource: false,
      },
      mockPlex as any
    );

    const result = await processor.process({
      downloadId: 'dl-123',
      source: 'usenet',
      artist: 'Pink Floyd',
      album: 'DSOTM',
      sourcePath: '/downloads/Pink_Floyd_DSOTM',
      files: [],
    });

    // Files moved successfully, even if Plex scan failed
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement process**

```typescript
/**
 * Process a completed download:
 * 1. Translate source path
 * 2. Generate destination path
 * 3. Move files
 * 4. Trigger Plex scan
 */
async process(download: CompletedDownload): Promise<ProcessingResult> {
  log.info(`Processing download: ${download.artist} - ${download.album}`);
  
  try {
    // Step 1: Translate path from remote to local
    const localSourcePath = this.translatePath(download.sourcePath);
    
    // Verify source exists
    try {
      await stat(localSourcePath);
    } catch {
      return {
        success: false,
        error: `Source path not found: ${localSourcePath}`,
      };
    }
    
    // Step 2: Generate destination path
    const destinationPath = this.generateDestinationPath({
      artist: download.artist,
      album: download.album,
      year: download.year,
    });
    
    // Step 3: Move files
    const moveResult = await this.moveFiles(localSourcePath, destinationPath);
    
    if (!moveResult.success) {
      return {
        success: false,
        error: moveResult.error,
      };
    }
    
    // Step 4: Trigger Plex scan (non-blocking, best-effort)
    if (this.plex) {
      try {
        const plexPath = this.reverseTranslatePath(destinationPath);
        await this.plex.scanLibrary({ path: plexPath });
        log.info(`Triggered Plex scan for: ${plexPath}`);
      } catch (e) {
        log.warn(`Failed to trigger Plex scan: ${e}`);
        // Don't fail the whole process for Plex scan issues
      }
    }
    
    return {
      success: true,
      destinationPath,
      filesProcessed: moveResult.filesProcessed,
    };
  } catch (error) {
    log.error(`Processing failed: ${error}`);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Processing failed',
    };
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/post-processor.ts apps/api/tests/services/post-processor.test.ts
git commit -m "feat(postproc): add full download processing flow"
```

---

## Task 7: Post-Processing API Routes

**Files:**
- Create: `apps/api/src/routes/post-process.ts`
- Create: `apps/api/tests/api/post-process.test.ts`

**Step 1: Write failing test**

```typescript
// apps/api/tests/api/post-process.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

describe('POST /api/post-process/complete', () => {
  it('should trigger processing for a completed download', async () => {
    // Setup mock processor
    const mockProcessor = {
      process: vi.fn().mockResolvedValue({
        success: true,
        destinationPath: '/music/Artist/Album (2023)',
        filesProcessed: 10,
      }),
    };

    // Create test app with mocked services
    const app = await createTestApp({ postProcessor: mockProcessor });

    const response = await request(app)
      .post('/api/post-process/complete')
      .send({
        downloadId: 'sab-nzo-123',
        source: 'usenet',
        artist: 'Pink Floyd',
        album: 'The Dark Side of the Moon',
        year: 1973,
        sourcePath: '/downloads/complete/Pink_Floyd_DSOTM',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.destinationPath).toContain('Pink Floyd');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement route**

```typescript
// apps/api/src/routes/post-process.ts
import { Router } from 'express';
import { z } from 'zod';
import { PostProcessorService } from '../services/post-processor.js';

const router = Router();

const completeSchema = z.object({
  downloadId: z.string(),
  source: z.enum(['usenet', 'soulseek']),
  artist: z.string(),
  album: z.string(),
  year: z.number().optional(),
  sourcePath: z.string(),
  files: z.array(z.object({
    filename: z.string(),
    size: z.number(),
    extension: z.string(),
  })).optional(),
});

router.post('/complete', async (req, res) => {
  try {
    const data = completeSchema.parse(req.body);
    const processor = req.app.get('postProcessor') as PostProcessorService;
    
    const result = await processor.process({
      ...data,
      files: data.files ?? [],
    });
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
    } else {
      res.status(500).json({ error: 'Processing failed' });
    }
  }
});

export default router;
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/routes/post-process.ts apps/api/tests/api/post-process.test.ts
git commit -m "feat(postproc): add post-processing API route"
```

---

## Tasks 8-12: Remaining Post-Processing

- **Task 8**: SABnzbd webhook handler (`POST /api/webhooks/sabnzbd`)
- **Task 9**: slskd completion polling job
- **Task 10**: Database integration (update DownloadJob status)
- **Task 11**: Optional Lidarr add-back (add to Lidarr after files exist)
- **Task 12**: Integration tests for complete webhook → process → Plex flow

---

See [05-phase5-ui.md](05-phase5-ui.md) for Phase 5.
