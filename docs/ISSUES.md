# V2 STATUS REPORT

> **Last Updated:** January 5, 2026  
> **Status:** PRODUCTION READY

---

## ✅ CODE QUALITY CLEANUP (January 2026)

5-sprint cleanup completed to address technical debt identified in code review.

### Sprint 1: Immediate Fixes ✅
- Removed 200+ debug log statements
- Added `/health` endpoint with structured response
- Created `parseIntParam()` utility for safe ID parsing
- Fixed Express session type declarations

### Sprint 2: Type Safety ✅
- Eliminated 50+ `as any` type assertions
- Created typed config interfaces for all 9 connection types
- Added proper Prisma Json field typing
- Type-safe config access in workers

### Sprint 3: Validation & Error Handling ✅
- Added Zod validation middleware (`validateBody`, `validateQuery`, `validateParams`)
- Created Zod schemas for subscriptions (64 types), connections (9 types), users
- Added correlation ID middleware for request tracing
- Improved error handler with structured responses and Zod support
- 10 new middleware tests

### Sprint 4: Security & Logging ✅
- Audited rate limiting (already present, added to LDAP SSO)
- Audited CSRF protection (using `sameSite: 'lax'` cookies)
- Configured Helmet with explicit security headers
- Added structured JSON logging (`lib/logger.ts`)
- Added request logging middleware with correlation IDs
- 6 new security tests

### Sprint 5: Polish & Testing ✅
- Added 13 error handler tests
- Added 13 logger tests
- Cleaned up unused variables, added ESLint config
- Replaced all console.log/error with structured logger (21 files)
- Added JSDoc documentation to middleware and utilities

**Total New Tests:** 42  
**Files Modified:** 50+  
**Test Count:** 887 → 929+

---

## ✅ V2 CRITICAL GAPS - ALL RESOLVED

| Gap | Status | Resolution |
|-----|--------|------------|
| Auth Not Enforced | ✅ FIXED | `ProtectedLayout` wraps all routes, redirects to login/setup |
| AI Integration Missing | ✅ FIXED | `services/ai.ts` + `routes/ai.ts` with OpenAI/Anthropic SDKs |
| Spotify Import Incomplete | ✅ FIXED | `POST /api/imports/refresh` endpoint implemented |
| Subscription Presets Reduced | ✅ FIXED | 50+ presets now in `routes/subscriptions.ts` |
| Spotify Presets Missing | ✅ FIXED | Added editorial, personalized, category, followed, saved albums, liked songs |
| Result Handling Not Respected | ✅ FIXED | Subscriptions now use preview/queue/auto_add modes |
| Spotify Personalized Missing | ✅ FIXED | Discover Weekly, Release Radar, Daily Mix, On Repeat presets added |

## ✅ PARTIAL IMPLEMENTATIONS - RESOLVED

| Item | Status | Resolution |
|------|--------|------------|
| spotify_new_releases handler | ✅ FIXED | Uses Spotify Browse API via `getAllNewReleases()` |
| MusicBrainz subscription presets | ✅ FIXED | `musicbrainz_new` type + presets added |
| All genre tags | ✅ FIXED | R&B, Country, Classical, Jazz, and 20+ more added |
| Geo country presets | ✅ FIXED | 15+ countries now available |
| Spotify editorial presets | ✅ FIXED | Featured Playlists, Top 50, RapCaviar, etc. |
| Spotify category presets | ✅ FIXED | Pop, Hip-Hop, Rock, Electronic via Browse Categories API |
| Setup wizard skippable | ⚠️ UNCHANGED | By design - Lidarr can be added later |

## ⚠️ MINOR ITEMS (Non-blocking)

All v2 gaps have been addressed. No remaining issues.

---

## V1 → V2 GAP ANALYSIS - SESSION FIXES

| Gap | Status | Resolution |
|-----|--------|------------|
| Spotify OAuth Flow | ✅ FIXED | API routes `/:id/spotify/auth`, `/:id/spotify/callback`, `/:id/spotify/status`, `/:id/spotify/revoke`. Frontend shows authorize button, handles callback params |
| Jobs Page Missing | ✅ FIXED | New `/jobs` page shows active/completed/failed jobs, auto-refreshes for active jobs |
| Subscription Presets Limited | ✅ FIXED | Preset picker with 60+ templates, category filtering |
| User Badges Missing | ✅ FIXED | Admins see owner info on connections, subscriptions, imports |
| Users Nav Missing | ✅ FIXED | Added Users link to sidebar |

### Remaining V1 Features Not Yet in V2

| Feature | V1 Location | Status | Notes |
|---------|-------------|--------|-------|
| Preview Pages | `/spotify-preview`, `/lastfm-preview` | ✅ FIXED | `/preview` page with Spotify/Last.fm support via query params |
| Direct Artist Import from Preview | `routes.py` | ✅ FIXED | Preview page has artist selection + import to Lidarr |
| Similar Artists from Last.fm | `lastfm.py` | ✅ FIXED | Last.fm preview fetches similar artists via `getArtistInfo()` |
| AI on Import Preview | Multiple | ✅ FIXED | Preview page shows AI recommendations panel with toggle |

---

| Item | Status | Notes |
|------|--------|-------|
| Data Retention | ✅ IMPLEMENTED | Daily cleanup at 3 AM UTC - 30 days for results/runs, 7 days for logs |
| Concurrent Run Prevention | ✅ IMPLEMENTED | Fixed job IDs with deduplication check before adding to queue |

---

## V2 IMPLEMENTATION SUMMARY

### Core Features
- **Auth System**: JWT + session-based, admin/user roles, protected routes
- **AI Integration**: OpenAI + Anthropic, 3 strategies (similar, genre_expansion, discovery)
- **Subscriptions**: 50+ presets (charts, tags, geo, Spotify editorial/personalized/category, MusicBrainz)
- **Result Handling**: preview, queue, or auto_add modes for subscriptions
- **Spotify Import**: Refresh sources, enable/disable, 3 modes (preview, queue, auto)
- **Search**: Multi-type (artist, album, label, year), bulk import, enrichment
- **Dashboard**: Real-time stats, activity feed, connections summary
- **Connection Scraping**: Background jobs with BullMQ, scheduler, history

### Infrastructure
- **Frontend**: Next.js 14, App Router, Tailwind CSS, dark mode, responsive
- **Backend**: Express.js, Prisma ORM, BullMQ workers, Redis queues
- **Database**: MySQL 8.0 with full schema
- **Docker**: 4 containers (web:3010, api:3005 internal, redis, mysql)

---

## FEATURE REQUESTS - ORIGINAL V1 (All Completed)

1. **Subscriptions (Last.fm)** - ✅ V1+V2
   - Users can subscribe to Last.fm charts, tags, geo-based lists
   - 40+ presets available (expanded in V2)
   - Recurring scheduled checks with automatic Lidarr additions

2. **Subscriptions (Spotify)** - ✅ V1+V2
   - Subscribe to Spotify playlists, followed artists, saved albums, liked songs
   - Public + personalized presets
   - Integrated with subscription infrastructure

3. **Spotify Import** - ✅ V1+V2
   - Import liked songs, saved albums, followed artists, playlists
   - Each source can be individually enabled/disabled
   - Preview before adding, review queue for pending items
   - Manual or scheduled execution

4. **AI Recommendations** - ✅ V1+V2
   - OpenAI and Anthropic integration
   - Three strategies: similar, genre_expansion, discovery
   - Results filtered against Lidarr library

5. **Modular Codebase** - ✅ V2
   - Services separated by concern (ai, spotify, lastfm, lidarr, musicbrainz)
   - Routes organized by feature
   - Workers for background processing

6. **Collapsible Sidebar** - ✅ V2
   - Responsive sidebar with navigation

7. **Dark Mode** - ✅ V2
   - Theme toggle with system preference detection

8. **Mobile Friendly** - ✅ V2
   - Responsive design, mobile navigation

9. **Full-Stack JavaScript Conversion** - ✅ V2
   - React (Next.js 14) frontend
   - Node.js/Express backend
   - TypeScript throughout

10. **Users and Authentication** - ✅ V2
    - User management (register, login, logout)
    - Role-based access (admin, standard user)
    - Per-user connections, subscriptions, import history
    - Admin user CRUD management page
    - Per-user AI preferences

11. **Docker Security** - ✅ V2
    - Only web exposed (port 3000)
    - API and database internal to Docker network

12. **100% Dockerized** - ✅ V2
    - Single docker-compose.yml
    - No manual setup beyond Docker


13. ✅ **Multi-User Data Isolation** - IMPLEMENTED
   - Lidarr connections are global (admin-only creation)
   - Spotify/LastFM connections are per-user
   - Subscriptions and Import Sources are per-user
   - AI preferences are per-user (global API keys, user-specific settings)
   - Admin users can see/manage all users' data
   - Standard users only see their own data
   - Settings page hidden from non-admin users
   - Admin user management UI on Users page


14. ✅ **Real-Time Job Updates** - IMPLEMENTED
   - WebSocket connection for real-time job progress
   - Frontend shows live updates during subscription/import execution
   - Progress bars, status messages, error handling
   - Activity feed updates in real-time

15. ✅ **Migrate AI Recommendations to Subscriptions** - IMPLEMENTED
   - AI recommendations as a subscription type (`ai_recommendation`)
   - Config: `source` (spotify/lastfm), `strategy` (similar/genre_expansion/discovery), `limit`
   - 6 presets: AI Similar/Genre Expansion/Discovery for both Spotify and Last.fm sources
   - Runs through subscription scheduler with result handling (preview/queue/auto_add)
   - Settings page AI section now API keys only


16. ✅ **Avatar Button** - IMPLEMENTED
   - Avatar button added for user profile/settings access
   - Dropdown menu with profile, settings, logout options
   - Consistent with modern UI patterns

17. ✅ **Dark/Light Mode Toggle** - IMPLEMENTED
   - Theme toggle in sidebar
   - Improved accessibility and visibility
   - Consistent with common design practices

18. ✅ **Review Queue Page** - IMPLEMENTED
   - New `/queue` page to review pending import items
   - Options to approve/reject individual artists
   - Bulk actions with select all
   - Filter by status (pending/approved/rejected)
   - Search functionality
   - Added to sidebar navigation

19. ✅ **Remove Unconfigured Default Connections** - ALREADY IMPLEMENTED
   - Setup wizard only creates admin user, not connections
   - Connections step is informational only with links to /connections
   - No empty connections created during setup


20. ✅ **Remove Spotify Import Page** - IMPLEMENTED
   - Page removed, sidebar link removed
   - All import functionality available via Subscriptions page


21. ✅ **Per-user Object Labels** - IMPLEMENTED
   - Each object shows owner username in lists/details
   - Subscriptions, Connections, Review Queue, Jobs all show owner badges
   - Admins can see which user owns each item
   - Clear ownership indication throughout UI

22. ✅ **Subscription Results Status Filters** - IMPLEMENTED
   - Status filter buttons on results list
   - Filter by pending, approved, rejected, skipped, added, queued, etc
   - Shows count per status for quick overview
   - Improves usability for large result sets

23. ✅ **Per-Subscription AI Strategy** - IMPLEMENTED
      - Subscription form includes strategy dropdown when type is `ai_recommendation`
      - Also includes source dropdown (Spotify or Last.fm)
      - Overrides global AI strategy for that subscription
      - Allows fine-tuning of AI behavior per subscription

24. ✅ **Dynamic Discover Weekly and Release Radar** - ALREADY IMPLEMENTED
      - These playlists are fetched dynamically by searching user's playlists by name
      - Uses `findSpotifyPlaylistByName()` to locate Spotify-owned playlists
      - No hardcoded playlist IDs - looks up current playlist each time
      - Spotify automatically updates these playlists weekly, subscription gets latest content


25. ✅ **Bulk Approve/Reject in Review Queue** - IMPLEMENTED
      - Checkbox selection for each item
      - "Select All" option
      - Bulk action buttons for approve/reject with loading spinners
      - Streamlines review process for large queues

26. ✅ **Multi-Page Selection on Discover Library** - IMPLEMENTED
      - Selection state persists across pages (already worked, just needed UI)
      - "Select All on Page" adds current page to existing selection (doesn't replace)
      - Collapsible panel shows all selected artists with remove (X) button
      - Selected count shown in toggle button
      - Can remove individual artists from selection without navigating back

27. Multi-selection of artists in Discover Search Results ("Recommendations" tab)
      - Checkbox for each artist in recommendations list
      - "Select All" option
      - "Download selected" button to add all selected artists to review queue or Lidarr


28. Community feature requests

   Based on my search through forums, GitHub issues, and community discussions, here are the key pain points and feature requests that the Lidarr community is asking for.  I want to explore these to see what gaps still exist that your our could address.  Review the below analysis.  Identify what is already covered by our tool, and what gaps remain that our tool could implement to differentiate itself.

   Start by eliminating any items or points below that are already covered by our app.

   Then, revise the list into an ordered, prioritized set of features tthat we can implement to address the remaining gaps.

   I want the final list to be a clear set of features that our tool can focus on to provide unique value to Lidarr users.  From the list, we should be able to drive development priorities and roadmap following CLAUDE.instructions.md and testing*.md

   Major Pain Points
   1. Metadata Server Issues

   The Lidarr API/metadata server frequently has outages and errors (500 errors, timeouts)
   This breaks core functionality like searching for new artists
   Community is frustrated with the reliability issues

   2. Limited Music Discovery

   Lidarr is primarily a collection manager, not a discovery tool
   Users want better integration with discovery services
   Current import lists are limited

   3. Incomplete MusicBrainz Data

   Albums missing due to incorrect/unknown release types in MusicBrainz
   Some artists only show partial discographies
   Metadata quality varies significantly

   Most Requested Features
   1. Enhanced Discovery & Recommendations

   Genre-based discovery: Ability to auto-download by genre/tags
   Record label support: Import entire record label catalogs (PR already submitted!)
   Better playlist integration: Full Spotify/Apple Music playlist support
   AI-powered recommendations: Smart discovery based on listening patterns

   2. Advanced Search & Filtering

   Filter search results by release type (soundtracks, compilations, etc.)
   Support for more complex search queries
   Better handling of disambiguation (same album names)

   3. Import List Improvements

   Album-level imports: Currently only supports artist-level imports
   ListenBrainz integration: Better support for music recommendation services
   Custom list enhancements: Import specific albums, not just artists
   Chart imports: Billboard, Last.fm charts, etc.

   4. Organization Features

   Genre folders: Support for genre-based folder structures
   Multi-library support: Different folders for different quality/genres
   Better duplicate handling: Smarter management of multiple versions

   5. Integration Requests

   Overseerr-like request system: User-friendly request interface for music
   Better streaming service sync: Real-time sync with Spotify library changes
   Improved download client integration: Better handling of music-specific needs

   6. Quality of Life Improvements

   Preview before adding: Listen to samples before downloading
   Automatic genre tagging: Pull genre data from multiple sources
   Better error handling: More informative error messages
   Offline artist addition: Add artists when metadata server is down

   Community Tools Addressing These Gaps
   Several tools have emerged to fill these gaps:

   Lidify: Adds Spotify/Last.fm recommendations
   Sonobarr: Advanced discovery with AI assistance
   DiscoveryLastFM: Automated discovery based on listening history
   Lidarr-Extended: Enhanced functionality through scripts

   What Your Tool Could Focus On
   Based on these findings, your music discovery tool could differentiate itself by:

   Reliable record label browsing (highly requested, PR pending)
   Multi-source discovery combining Spotify, Last.fm, Bandcamp, etc.
   Chart integration from multiple sources
   Genre-based discovery with smart filtering
   Playlist management that works when Spotify API changes
   Offline functionality when Lidarr's metadata server is down
   Batch operations for adding multiple artists/albums efficiently
   Discovery scheduling to automatically find new music periodically
   Recommendation engine that learns from your Lidarr library
   Request system integration for multi-user environments

   The community clearly wants more robust discovery features that go beyond Lidarr's current capabilities while maintaining reliable integration with their existing setup.



   29. ✅ **Enhance search results and search feature** - IMPLEMENTED

      1. ✅ Added search/sort/filter controls on the label search results "view artists" modal
         - Search input to filter artists by name
         - Sort dropdown (A→Z, Z→A) for alphabetical ordering
         - Infinite scroll for pagination (loads 50 artists at a time)
      2. ✅ Added better error handling when user adds an artist to Lidarr from "album" search results
         - Now shows user-friendly info toast: "Artist already exists in your Lidarr library"
         - Detects `ArtistExistsValidator` error code and displays helpful message





   30. ✅ **Remove legacy v1 code and promote v2** - IMPLEMENTED

      1. ✅ Removed all legacy v1 Python/Flask code from codebase
      2. ✅ Updated all documentation and instructions with new paths
      3. ✅ Migrated v2 code from /v2/ folder to project root


31. ✅ **Users and Settings** - IMPLEMENTED

 1. ~~Current behavior~~
   - ~~currently, non-admin users can see the Users sidebar nav link.  Clicking it shows the users' own settings page.~~
   - ~~currently, non-admin users clicking on "avatar" in the lower-left corner navigates to the dashboard~~

 2. ~~Expected behavior:~~
   - ~~non-admin users can NOT see the Users sidebar link.~~
   - ~~non admin users can NOT access the users settings page for other users~~
   - ~~non-admin users clicking on "avatar" in the lower-left corner navigates to the users' own settings page~~

 3. Resolution:
   - Added `adminOnly: true` to Users sidebar nav item
   - Created `/users/me` page for personal profile/settings
   - Avatar menu now routes non-admins to `/users/me`, admins to `/users`


32. ❌ **SSO Badge** - CANCELLED

   - ~~add a badge to the "avatar" menu in the lower left, and the user settings page, indicating which login method the current user used to login (local, plex, sso, etc)~~
   - Cancelled during design review


33. ✅ **UI Update** - IMPLEMENTED

   1. ~~increase the size of the artist/album thumbnails wherever they are displayed, to be more competitive with apps like lidify and tubifarry.  keep the same minimal, sleek ux/ui aesthetic of our app - don't make the images too large.  maybe double their curent size or so.  make sure the layout remains responsive on mobile devices.~~

   2. ~~add links in artist/slbum result rows to "listen" and "artist details" pages.  Select from avaialble enrichment sources - spotify, musicbrainz, last.fm, deezer, etc.  The "listen" link opens the spotify deezer, or youtube music page for that artist/album in a new tab.  The "artist details" link opens the musicbrainz or last.fm page for that artist in a new tab.~~

   3. Resolution:
      - Thumbnails standardized to `w-16 h-16 sm:w-20 sm:h-20 rounded-md` (64px mobile, 80px desktop)
      - Created reusable `ArtistCard`, `AlbumCard`, `ExternalLinks` components
      - External links (Spotify, Last.fm, MusicBrainz) added as icon-only buttons
      - Applied to: search results, discover page, subscription results, queue, label artists


34. ✅ **Better Logging** - IMPLEMENTED

   - ~~artists added from most locations (e.g. Search results) display toasts notifying of add results, but nothing is logged  to the "logs" activity feed.  Add log entries for these actions so users can review what artists were added from where, and when.~~

   - Resolution: Added `addLogEntry` calls in search.ts for artist additions with artist name, source, user, and status


35. ✅ **Spotify Import on Dashboard** - IMPLEMENTED

      - ~~remove the "spotify import" tile from the dashboard, as the spotify import page has been removed and all functionality is now in subscriptions.~~

      - Resolution: Removed `/spotify-import` tile from dashboard quickLinks array

---

## 🔧 TECHNICAL DEBT (Deferred)

### TD-001: Migrate LDAP from deprecated ldapjs to ldapts

**Priority:** Medium  
**Created:** January 2, 2026  
**Status:** Deferred

**Problem:**
Build warnings show `ldapjs@2.3.3` is deprecated. The dependency chain is:
- `passport-ldapauth@3.0.1` → `ldapauth-fork@5.0.5` → `ldapjs@2.3.3` (deprecated)
- `passport-ldapauth` last updated June 2022 (3+ years stale)

**Solution:**
Replace `passport-ldapauth` with `ldap-authentication` package which uses `ldapts` (actively maintained, last updated Dec 2025).

**Migration Steps:**
1. Install `ldap-authentication` package
2. Create custom Passport strategy wrapping `ldap-authentication`
3. Update `apps/api/src/auth/strategies/ldap.ts` to use new library
4. Update tests
5. Remove `passport-ldapauth` dependency

**Files Affected:**
- `apps/api/package.json`
- `apps/api/src/auth/strategies/ldap.ts`
- Related tests

**Notes:**
- LDAP is a critical feature, migration required eventually
- `whatwg-encoding` deprecation warning (from cheerio) is benign and can be ignored
---

### TD-002: Lidarr Rescan Behavior Causes Full Library Scans

**Priority:** High (User Impact)  
**Created:** January 3, 2026  
**Status:** Documented - Workaround Available

**Problem:**
When Mixarr's Library Health features trigger `RefreshArtist` commands for existing artists in Lidarr, each refresh causes a full root folder scan (not just the artist's folder). This is due to Lidarr's internal behavior in `RefreshArtistService.RescanArtists()`:

```csharp
// For NEW artists: scans only artist folder
if (isNew) {
    folders = artists.Select(x => x.Path).ToList();
}
// For EXISTING artists: scans ALL root folders by default
else {
    folders = _rootFolderService.All().Select(x => x.Path).ToList();
}
```

When bulk refresh operations are triggered (e.g., "Refresh Incomplete Artists"), this queues many `RefreshArtist` commands, each triggering a full library scan. With large libraries (30K+ files), these scans can take hours and queue up for days.

**Affected Mixarr Features:**
- Library Health → Refresh single artist
- Library Health → Bulk refresh incomplete artists
- Library Health → Bulk refresh by issue type

**Workaround (Recommended):**
In Lidarr, go to **Settings → Media Management** and set **"Rescan Artist Folder after Refresh"** to **Never**.

This will:
- ✅ Still scan new artist folders when added from Mixarr
- ✅ Stop existing artist refreshes from triggering full library scans
- ✅ Allow manual rescans when actually needed

**Notes:**
- Adding NEW artists is not affected - those always scan only the artist's folder
- This is Lidarr's internal behavior, not something Mixarr can control via API
- Users with large libraries should set this to "Never" before using bulk refresh features