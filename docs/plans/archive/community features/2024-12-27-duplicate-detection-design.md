# Duplicate Artist Detection & Cleanup Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 2 - Medium Impact  
**Effort:** Medium  

## Problem Statement

Users accumulate duplicate artists in Lidarr from various sources:
- Name variations: "The Beatles" vs "Beatles"
- Punctuation differences: "P!nk" vs "Pink"
- Unicode issues: "Björk" vs "Bjork"
- Multiple MBIDs for same artist (rare but happens)
- Accidental re-adds from different subscriptions

Currently, users must manually identify and merge duplicates in Lidarr, which is tedious.

## Solution

Create a duplicate detection feature that:
1. Scans Lidarr library for potential duplicate artists
2. Uses fuzzy matching to identify similar names
3. Presents merge candidates for user review
4. Provides guidance on merging in Lidarr/MusicBrainz

## Design

### Duplicate Detection Algorithm

```typescript
interface DuplicateCandidate {
  artist1: LidarrArtist;
  artist2: LidarrArtist;
  similarity: number;      // 0-1 score
  matchType: MatchType;
  confidence: 'high' | 'medium' | 'low';
}

enum MatchType {
  EXACT_NORMALIZED = 'exact_normalized',     // Same after normalization
  FUZZY_HIGH = 'fuzzy_high',                 // >90% similar
  FUZZY_MEDIUM = 'fuzzy_medium',             // 80-90% similar
  PREFIX_MATCH = 'prefix_match',             // "The X" vs "X"
  MUSICBRAINZ_LINK = 'musicbrainz_link',     // MB says they're related
}

function detectDuplicates(artists: LidarrArtist[]): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  
  for (let i = 0; i < artists.length; i++) {
    for (let j = i + 1; j < artists.length; j++) {
      const match = compareArtists(artists[i], artists[j]);
      if (match && match.similarity > 0.8) {
        candidates.push(match);
      }
    }
  }
  
  return candidates.sort((a, b) => b.similarity - a.similarity);
}
```

### Name Normalization

```typescript
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/i, '')           // Remove leading "The"
    .replace(/[^\w\s]/g, '')           // Remove punctuation
    .normalize('NFD')                   // Decompose unicode
    .replace(/[\u0300-\u036f]/g, '')   // Remove diacritics
    .replace(/\s+/g, ' ')              // Normalize whitespace
    .trim();
}

// Examples:
// "The Beatles" → "beatles"
// "P!nk" → "pnk"
// "Björk" → "bjork"
// "AC/DC" → "acdc"
```

### Fuzzy Matching

Use Levenshtein distance and other algorithms:

```typescript
import { distance, closest } from 'fastest-levenshtein';
import Fuse from 'fuse.js';

function calculateSimilarity(name1: string, name2: string): number {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);
  
  // Exact match after normalization
  if (norm1 === norm2) return 1.0;
  
  // Levenshtein distance as percentage
  const maxLen = Math.max(norm1.length, norm2.length);
  const dist = distance(norm1, norm2);
  const levenshteinScore = 1 - (dist / maxLen);
  
  // Also check for prefix/suffix patterns
  const prefixScore = checkPrefixMatch(norm1, norm2);
  
  return Math.max(levenshteinScore, prefixScore);
}

function checkPrefixMatch(name1: string, name2: string): number {
  // "beatles" should match with higher confidence to "beatles" 
  // from "the beatles"
  if (name1.includes(name2) || name2.includes(name1)) {
    return 0.95;
  }
  return 0;
}
```

### Duplicate Detection Service

**File:** `apps/api/src/services/duplicate-detection.ts`

```typescript
export class DuplicateDetectionService {
  constructor(private lidarr: LidarrService) {}
  
  async scan(): Promise<DuplicateScanResult> {
    const artists = await this.lidarr.getArtists();
    const candidates = detectDuplicates(artists);
    
    return {
      totalArtists: artists.length,
      duplicatesFound: candidates.length,
      candidates: candidates.slice(0, 100), // Limit results
      scannedAt: new Date(),
    };
  }
  
  async getDuplicates(
    minConfidence: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<DuplicateCandidate[]>;
  
  async dismissDuplicate(artist1Id: number, artist2Id: number): Promise<void>;
  // Store dismissal so it doesn't show again
  
  async getMergeGuidance(
    candidate: DuplicateCandidate
  ): Promise<MergeGuidance>;
}

interface MergeGuidance {
  recommendation: 'keep_first' | 'keep_second' | 'merge_in_musicbrainz';
  reasoning: string;
  firstArtist: {
    albumCount: number;
    trackCount: number;
    sizeOnDisk: number;
  };
  secondArtist: {
    albumCount: number;
    trackCount: number;
    sizeOnDisk: number;
  };
  musicbrainzUrl?: string;
}
```

### API Routes

**File:** `apps/api/src/routes/duplicates.ts`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/duplicates/scan` | POST | Trigger duplicate scan |
| `/api/duplicates` | GET | Get detected duplicates |
| `/api/duplicates/:id/dismiss` | POST | Dismiss a candidate |
| `/api/duplicates/:id/guidance` | GET | Get merge guidance |

### Frontend UI

**File:** `apps/web/src/app/duplicates/page.tsx`

```
┌──────────────────────────────────────────────────────────────┐
│ Duplicate Detection                              [Scan Now]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Found 5 potential duplicates                                │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ HIGH CONFIDENCE (99%)                                  │  │
│  │                                                        │  │
│  │  "The Beatles"          ↔     "Beatles"               │  │
│  │   8 albums, 156 tracks       0 albums, 0 tracks       │  │
│  │                                                        │  │
│  │  Recommendation: Keep "The Beatles" (more content)     │  │
│  │                                                        │  │
│  │  [View in Lidarr]  [View on MusicBrainz]  [Dismiss]   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ MEDIUM CONFIDENCE (87%)                                │  │
│  │                                                        │  │
│  │  "Guns N' Roses"        ↔     "Guns n Roses"          │  │
│  │   12 albums, 180 tracks       3 albums, 42 tracks     │  │
│  │                                                        │  │
│  │  [View in Lidarr]  [View on MusicBrainz]  [Dismiss]   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Database Schema

Track dismissed candidates to avoid reshowing:

```prisma
model DismissedDuplicate {
  id           Int      @id @default(autoincrement())
  userId       Int
  mbid1        String
  mbid2        String
  dismissedAt  DateTime @default(now())
  
  user         User     @relation(fields: [userId], references: [id])
  
  @@unique([userId, mbid1, mbid2])
}
```

### Integration Notes

**Lidarr Merge Workflow:**
Mixarr cannot automatically merge artists in Lidarr. The workflow is:
1. User identifies duplicate in Mixarr
2. User goes to Lidarr, removes the "worse" duplicate
3. Optionally, user updates MusicBrainz to prevent future issues

**MusicBrainz Link:**
For true duplicates (same artist, different MBIDs), link to MusicBrainz merge request page.

## Performance Considerations

- O(n²) comparison for n artists - could be slow for large libraries
- Optimization: Pre-compute normalized names, use blocking by first letter
- Cache scan results for 24 hours

```typescript
// Blocking optimization - only compare artists with same first letter
function detectDuplicatesOptimized(artists: LidarrArtist[]): DuplicateCandidate[] {
  const blocks = new Map<string, LidarrArtist[]>();
  
  for (const artist of artists) {
    const key = normalizeName(artist.artistName)[0] || 'other';
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key)!.push(artist);
  }
  
  const candidates: DuplicateCandidate[] = [];
  for (const [, block] of blocks) {
    // Only compare within same block
    candidates.push(...detectDuplicatesInBlock(block));
  }
  
  return candidates;
}
```

## Implementation Checklist

1. [ ] Implement name normalization utilities
2. [ ] Add fuzzy matching with Levenshtein distance
3. [ ] Create DuplicateDetectionService
4. [ ] Add API routes
5. [ ] Create frontend duplicate review page
6. [ ] Add dismissal tracking in database
7. [ ] Optimize for large libraries
8. [ ] Write tests with edge cases

## Success Metrics

- Accurately identifies 90%+ of true duplicates
- Few false positives at "high confidence" level
- Users can review and dismiss in < 30 seconds per candidate
