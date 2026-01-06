import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { LidarrService } from '../services/lidarr.js';
import { 
  detectDuplicates, 
  ArtistInfo,
  DuplicateScanResult 
} from '../services/duplicate-detection.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('DuplicatesRoute');

export const duplicatesRouter = Router();

duplicatesRouter.use(requireAuth);

// Cache for scan results
let scanCache: {
  result: DuplicateScanResult | null;
  timestamp: Date | null;
} = { result: null, timestamp: null };

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Helper to get Lidarr connection
async function getLidarrService(userId: number): Promise<LidarrService | null> {
  const connection = await prisma.connection.findFirst({
    where: {
      type: 'lidarr',
      isActive: true,
      OR: [{ userId }, { userId: null }],
    },
  });

  if (!connection) return null;

  const config = connection.config as { url: string; apiKey: string };
  return new LidarrService(config);
}

// Trigger duplicate scan
duplicatesRouter.post('/scan', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      return res.status(400).json({ error: 'Lidarr not configured' });
    }

    const artists = await lidarr.getArtists();

    // Map to ArtistInfo format
    const artistInfos: ArtistInfo[] = artists.map((a: any) => ({
      id: a.id,
      artistName: a.artistName,
      foreignArtistId: a.foreignArtistId,
      albumCount: a.statistics?.albumCount || 0,
      trackCount: a.statistics?.totalTrackCount || 0,
      sizeOnDisk: a.statistics?.sizeOnDisk || 0,
    }));

    const candidates = detectDuplicates(artistInfos);

    // Filter out dismissed duplicates
    const dismissed = await prisma.dismissedDuplicate.findMany({
      where: { userId: req.user!.id },
    });

    const dismissedPairs = new Set(
      dismissed.map(d => `${d.mbid1}:${d.mbid2}`)
    );

    const filteredCandidates = candidates.filter(c => {
      const key1 = `${c.artist1.foreignArtistId}:${c.artist2.foreignArtistId}`;
      const key2 = `${c.artist2.foreignArtistId}:${c.artist1.foreignArtistId}`;
      return !dismissedPairs.has(key1) && !dismissedPairs.has(key2);
    });

    const result: DuplicateScanResult = {
      totalArtists: artistInfos.length,
      duplicatesFound: filteredCandidates.length,
      candidates: filteredCandidates.slice(0, 100),
      scannedAt: new Date(),
    };

    // Cache the result
    scanCache = { result, timestamp: new Date() };

    res.json(result);
  } catch (error) {
    logger.error('Duplicate scan error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Scan failed' 
    });
  }
});

// Get cached duplicates or trigger scan
duplicatesRouter.get('/', async (req, res) => {
  try {
    const minConfidence = req.query.minConfidence as string || 'medium';
    
    // Check cache
    if (
      scanCache.result && 
      scanCache.timestamp &&
      Date.now() - scanCache.timestamp.getTime() < CACHE_DURATION_MS
    ) {
      let filtered = scanCache.result.candidates;
      
      if (minConfidence === 'high') {
        filtered = filtered.filter(c => c.confidence === 'high');
      } else if (minConfidence === 'medium') {
        filtered = filtered.filter(c => c.confidence === 'high' || c.confidence === 'medium');
      }
      
      return res.json({
        ...scanCache.result,
        candidates: filtered,
        duplicatesFound: filtered.length,
        fromCache: true,
      });
    }

    // No cache, need to scan first
    res.json({
      totalArtists: 0,
      duplicatesFound: 0,
      candidates: [],
      scannedAt: null,
      fromCache: false,
      message: 'No scan results available. Trigger a scan first.',
    });
  } catch (error) {
    logger.error('Get duplicates error', { error });
    res.status(500).json({ error: 'Failed to get duplicates' });
  }
});

// Dismiss a duplicate candidate
duplicatesRouter.post('/:id/dismiss', async (req, res) => {
  try {
    const { mbid1, mbid2 } = req.body;

    if (!mbid1 || !mbid2) {
      return res.status(400).json({ error: 'mbid1 and mbid2 are required' });
    }

    // Sort MBIDs to ensure consistent storage
    const [sortedMbid1, sortedMbid2] = [mbid1, mbid2].sort();

    await prisma.dismissedDuplicate.upsert({
      where: {
        userId_mbid1_mbid2: {
          userId: req.user!.id,
          mbid1: sortedMbid1,
          mbid2: sortedMbid2,
        },
      },
      update: {},
      create: {
        userId: req.user!.id,
        mbid1: sortedMbid1,
        mbid2: sortedMbid2,
      },
    });

    // Remove from cache
    if (scanCache.result) {
      scanCache.result.candidates = scanCache.result.candidates.filter(c => {
        const key1 = `${c.artist1.foreignArtistId}:${c.artist2.foreignArtistId}`;
        const key2 = `${c.artist2.foreignArtistId}:${c.artist1.foreignArtistId}`;
        const dismissKey = `${sortedMbid1}:${sortedMbid2}`;
        return key1 !== dismissKey && key2 !== dismissKey;
      });
      scanCache.result.duplicatesFound = scanCache.result.candidates.length;
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Dismiss duplicate error', { error });
    res.status(500).json({ error: 'Failed to dismiss duplicate' });
  }
});

// Get merge guidance for a duplicate pair
duplicatesRouter.get('/:id/guidance', async (req, res) => {
  try {
    const { artist1Id, artist2Id } = req.query;

    if (!artist1Id || !artist2Id) {
      return res.status(400).json({ error: 'artist1Id and artist2Id are required' });
    }

    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      return res.status(400).json({ error: 'Lidarr not configured' });
    }

    // Fetch artists, quality profiles, and track files in parallel
    const [artists, qualityProfiles] = await Promise.all([
      lidarr.getArtists(),
      lidarr.getQualityProfiles(),
    ]);
    
    const artist1 = artists.find((a: any) => a.id === parseInt(artist1Id as string, 10));
    const artist2 = artists.find((a: any) => a.id === parseInt(artist2Id as string, 10));

    if (!artist1 || !artist2) {
      return res.status(404).json({ error: 'Artists not found' });
    }

    // Fetch track files for both artists in parallel
    const [trackFiles1, trackFiles2] = await Promise.all([
      lidarr.getTrackFilesForArtist(artist1.id).catch(() => []),
      lidarr.getTrackFilesForArtist(artist2.id).catch(() => []),
    ]);

    // Helper to calculate audio stats from track files
    const calcAudioStats = (trackFiles: any[]) => {
      if (!trackFiles || trackFiles.length === 0) {
        return { avgBitrate: null, formats: [], primaryFormat: null };
      }
      
      const formatCounts: Record<string, number> = {};
      let totalBitrate = 0;
      let bitrateCount = 0;
      
      for (const tf of trackFiles) {
        const codec = tf.mediaInfo?.audioCodec || tf.quality?.quality?.name || 'Unknown';
        formatCounts[codec] = (formatCounts[codec] || 0) + 1;
        
        if (tf.mediaInfo?.audioBitrate) {
          totalBitrate += tf.mediaInfo.audioBitrate;
          bitrateCount++;
        }
      }
      
      const formats = Object.keys(formatCounts).sort((a, b) => formatCounts[b] - formatCounts[a]);
      const primaryFormat = formats[0] || null;
      const avgBitrate = bitrateCount > 0 ? Math.round(totalBitrate / bitrateCount / 1000) : null;
      
      return { avgBitrate, formats, primaryFormat };
    };

    const audio1 = calcAudioStats(trackFiles1);
    const audio2 = calcAudioStats(trackFiles2);

    // Helper to build detailed artist info
    const buildArtistDetails = (artist: any, audioStats: any, qProfiles: any[]) => {
      const stats = artist.statistics || {};
      const trackCount = stats.trackCount || 0;
      const trackFileCount = stats.trackFileCount || 0;
      const percentComplete = trackCount > 0 ? Math.round((trackFileCount / trackCount) * 100) : 0;
      const qualityProfile = qProfiles.find(p => p.id === artist.qualityProfileId);
      
      return {
        id: artist.id,
        name: artist.artistName,
        foreignArtistId: artist.foreignArtistId,
        path: artist.path || artist.rootFolderPath || '',
        rootFolder: artist.rootFolderPath || '',
        qualityProfile: qualityProfile?.name || 'Unknown',
        monitored: artist.monitored,
        albumCount: stats.albumCount || 0,
        trackCount,
        trackFileCount,
        percentComplete,
        sizeOnDisk: stats.sizeOnDisk || 0,
        avgBitrate: audioStats.avgBitrate,
        formats: audioStats.formats,
        primaryFormat: audioStats.primaryFormat,
        musicbrainzUrl: `https://musicbrainz.org/artist/${artist.foreignArtistId}`,
      };
    };

    const details1 = buildArtistDetails(artist1, audio1, qualityProfiles);
    const details2 = buildArtistDetails(artist2, audio2, qualityProfiles);

    // Determine recommendation
    let recommendation: 'keep_first' | 'keep_second' | 'merge_in_musicbrainz';
    let reasoning: string;

    if (details1.albumCount > details2.albumCount) {
      recommendation = 'keep_first';
      reasoning = `"${artist1.artistName}" has more albums (${details1.albumCount} vs ${details2.albumCount})`;
    } else if (details2.albumCount > details1.albumCount) {
      recommendation = 'keep_second';
      reasoning = `"${artist2.artistName}" has more albums (${details2.albumCount} vs ${details1.albumCount})`;
    } else if (details1.sizeOnDisk > details2.sizeOnDisk) {
      recommendation = 'keep_first';
      reasoning = `"${artist1.artistName}" has more content downloaded`;
    } else if (details2.sizeOnDisk > details1.sizeOnDisk) {
      recommendation = 'keep_second';
      reasoning = `"${artist2.artistName}" has more content downloaded`;
    } else {
      recommendation = 'merge_in_musicbrainz';
      reasoning = 'Both artists have similar content. Consider merging in MusicBrainz.';
    }

    res.json({
      recommendation,
      reasoning,
      firstArtist: details1,
      secondArtist: details2,
      musicbrainzUrl: `https://musicbrainz.org/artist/${artist1.foreignArtistId}`,
      comparison: {
        artist1: details1,
        artist2: details2,
      },
    });
  } catch (error) {
    logger.error('Get guidance error', { error });
    res.status(500).json({ error: 'Failed to get guidance' });
  }
});

// Clear cache (for testing/refresh)
duplicatesRouter.delete('/cache', async (_req, res) => {
  scanCache = { result: null, timestamp: null };
  res.json({ success: true });
});
