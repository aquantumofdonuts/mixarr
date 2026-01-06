# Simplified Onboarding Wizard Design

**Date:** 2026-01-02  
**Status:** Approved

## Overview

Simplify the onboarding wizard by removing the connections step and redirecting users to the authenticated `/connections` page after account creation.

## New Flow

```
/setup → Welcome → Admin creation → URL config → Success interstitial → /connections
```

## Changes

### Removed
- **Connections step** - Moved to authenticated `/connections` page
- **Complete step** - Replaced by minimal success interstitial
- **`ConnectionModal.tsx`** - Delete entirely
- **`/api/connections/setup/*` endpoints** - Remove all unauthenticated setup endpoints

### Kept
- Welcome screen with branding
- Admin user creation (username, password, display name)
- URL configuration step (with auto-detected default)

### Added
- **Success interstitial** - Minimal screen after URL config:
  - Checkmark icon
  - "Account created!"
  - "Next, connect your services."
  - "Continue to Connections" button → redirects to `/connections`

## Implementation

### Files to Modify

1. **`apps/web/src/app/setup/page.tsx`**
   - Change steps: `['welcome', 'admin', 'url', 'success']`
   - Remove connections step logic (modal states, service tracking, OAuth handling)
   - Add success step with redirect to `/connections`

2. **`apps/api/src/routes/connections.ts`**
   - Remove `/api/connections/setup` POST endpoint
   - Remove `/api/connections/setup/test-lidarr` endpoint
   - Remove `/api/connections/setup/:id/spotify/auth` endpoint
   - Remove `/api/connections/setup/:id/spotify/callback` endpoint

### Files to Delete

- `apps/web/src/components/setup/ConnectionModal.tsx`

## Benefits

- Eliminates all unauthenticated OAuth flows (source of redirect URI bugs)
- Reduces setup page complexity by ~60%
- Connections use battle-tested authenticated endpoints
- Single source of truth for connection management
- Simpler Spotify callback URI: just `/api/connections/:id/spotify/callback`
