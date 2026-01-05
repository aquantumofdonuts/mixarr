# Plex-Centric Music Management - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Mixarr from Lidarr-dependent to Plex-centric music management with multi-source fallbacks for discography and downloads.

**Architecture:** Plex becomes source of truth for library state. Mixarr orchestrates discovery and downloads via Prowlarr/SABnzbd/slskd. Lidarr becomes optional fallback.

**Tech Stack:** Express.js, Prisma, Redis, React/Next.js, Plex API, Prowlarr API, SABnzbd API, slskd API, MusicBrainz API

---

## Implementation Phases

| Phase | Name | Files | Estimated Tasks |
|-------|------|-------|-----------------|
| 1 | Foundation - New Connections | [01-phase1-foundation.md](01-phase1-foundation.md) | ~45 tasks |
| 2 | Discography Layer | [02-phase2-discography.md](02-phase2-discography.md) | ~35 tasks |
| 3 | Download Orchestration | [03-phase3-downloads.md](03-phase3-downloads.md) | ~40 tasks |
| 4 | Post-Processing | [04-phase4-postprocessing.md](04-phase4-postprocessing.md) | ~25 tasks |
| 5 | UI Integration | [05-phase5-ui.md](05-phase5-ui.md) | ~50 tasks |
| 6 | Automated Flows | [06-phase6-automation.md](06-phase6-automation.md) | ~30 tasks |

---

## New Database Models

Add to `apps/api/prisma/schema.prisma`:

```prisma
// New connection types
enum ConnectionType {
  lidarr
  spotify
  lastfm
  tautulli
  deezer
  tidal
  listenbrainz
  discogs
  plex        // NEW
  prowlarr    // NEW
  sabnzbd     // NEW
  slskd       // NEW
}

// Download job tracking
model DownloadJob {
  id              Int             @id @default(autoincrement())
  userId          Int             @map("user_id")
  status          DownloadStatus  @default(pending)
  artist          String          @db.VarChar(255)
  album           String          @db.VarChar(255)
  year            Int?
  source          DownloadSource
  sourceId        String?         @map("source_id") @db.VarChar(255)  // SABnzbd nzo_id or slskd id
  downloadPath    String?         @map("download_path") @db.VarChar(500)
  destinationPath String?         @map("destination_path") @db.VarChar(500)
  retryCount      Int             @default(0) @map("retry_count")
  lastError       String?         @map("last_error") @db.Text
  metadata        Json?           // Store discography source info
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")
  completedAt     DateTime?       @map("completed_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
  @@index([sourceId])
  @@map("download_jobs")
}

enum DownloadStatus {
  pending
  searching
  downloading
  processing
  complete
  failed
}

enum DownloadSource {
  usenet
  soulseek
  lidarr
}
```

---

## New Services Overview

| Service | File | Purpose |
|---------|------|---------|
| PlexService | `apps/api/src/services/plex.ts` | Library state, OAuth, scans |
| ProwlarrService | `apps/api/src/services/prowlarr.ts` | Indexer search |
| SabnzbdService | `apps/api/src/services/sabnzbd.ts` | Usenet downloads |
| SlskdService | `apps/api/src/services/slskd.ts` | Soulseek downloads |
| DiscographyService | `apps/api/src/services/discography.ts` | Multi-source album lookup |
| DownloadOrchestratorService | `apps/api/src/services/download-orchestrator.ts` | Unified download management |
| PostProcessorService | `apps/api/src/services/post-processor.ts` | File moving, Plex scan |

---

## Execution Order

1. Complete Phase 1 entirely before Phase 2
2. Phase 2 can be tested independently with mock data
3. Phase 3 depends on Phase 1 (Prowlarr, SABnzbd, slskd services)
4. Phase 4 depends on Phase 3 (needs download completion)
5. Phase 5 can start after Phase 2 (UI can use discography before downloads work)
6. Phase 6 requires Phases 1-4 complete

---

## Testing Strategy

- Each service gets unit tests with mocked HTTP responses
- Integration tests verify service interactions
- E2E tests for critical flows (Plex OAuth, download → post-process → scan)
- All tests must pass before moving to next phase
