# Design: Making Lidarr Optional

**Date:** 2026-01-05  
**Status:** Approved  
**Goal:** Allow users to use Mixarr as a recommendation engine without requiring a Lidarr connection

---

## Summary

Users want to use Mixarr for music discovery and recommendations without downloading via Lidarr. This design makes Lidarr optional by implementing graceful degradation throughout the application.

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| `auto` mode behavior without Lidarr | Silently degrade to `queue` |
| Add new `result_handling` mode? | No - `preview` and `queue` work without Lidarr |
| Discover without Lidarr? | Defer - it's fundamentally library-based |
| UI for Lidarr-dependent options | Show as disabled with tooltips |
| "In Library" badge without Lidarr | Hide entirely |

---

## Changes Required

### 1. Subscription Worker (`apps/api/src/jobs/subscription-worker.ts`)

**Current behavior:** Throws `'No active Lidarr connection'` at line ~119, failing all subscriptions.

**New behavior:**
- Make Lidarr connection optional
- Skip library deduplication if no Lidarr (can't check what's already in library)
- `auto` mode degrades to `queue` with status note `no_lidarr_connection`

```typescript
// Lidarr is optional - only required for 'auto' mode and library deduplication
const lidarrConn = findConnection('lidarr');
let lidarr: LidarrService | null = null;
let lidarrCache: LidarrCache | null = null;

if (lidarrConn) {
  const lidarrConfig = lidarrConn.config as { url: string; apiKey: string };
  lidarr = new LidarrService(lidarrConfig);
  lidarrCache = new LidarrCache(lidarr);
  await lidarrCache.refresh();
}

// Later, in deduplication:
if (lidarrCache && await lidarrCache.exists({ name: artist.name, mbid: artist.mbid })) {
  // Skip - already in library
}

// Later, in auto mode:
if (resultHandling === 'auto') {
  if (!lidarr) {
    // Degrade to queue mode
    await prisma.subscriptionResult.create({
      data: {
        subscriptionId,
        runId: run.id,
        itemType: 'artist',
        name: artist.name,
        mbid,
        status: 'queued',
        skipReason: 'no_lidarr_connection',
        sources: sourcesArray,
        matchCount: sourcesArray.length,
      },
    });
    queued++;
    continue;
  }
  // ... existing Lidarr add logic
}
```

### 2. Import Worker (`apps/api/src/jobs/import-worker.ts`)

**Current behavior:** Throws for `auto` mode without Lidarr.

**New behavior:** Same as subscription worker - degrade `auto` to `queue`.

### 3. Search Routes (`apps/api/src/routes/search.ts`)

**Current behavior:** Returns 400 error without Lidarr.

**New behavior:**
- Search works without Lidarr
- `inLibrary` field is omitted from results (not returned at all)

```typescript
const lidarr = await getLidarrService(req.user!.id);
// Don't error - proceed without library status

// In result mapping:
const result = {
  name: artist.name,
  mbid: artist.mbid,
  // Only include inLibrary if we have Lidarr
  ...(lidarr && { inLibrary: await checkInLibrary(artistName) }),
};
```

### 4. Subscription Routes (`apps/api/src/routes/subscriptions.ts`)

**Current behavior:** Preview endpoint returns 400 without Lidarr.

**New behavior:** Preview works without Lidarr (just can't show library status).

### 5. Discover Routes (`apps/api/src/routes/discover.ts`)

**Current behavior:** Returns 400 error without Lidarr.

**New behavior:** Keep requiring Lidarr - Discover is fundamentally library-based. Improve error message.

```typescript
if (!lidarr) {
  res.status(400).json({ 
    error: 'Discover requires a Lidarr connection',
    code: 'LIDARR_REQUIRED',
    message: 'Connect Lidarr to browse and discover from your library'
  });
  return;
}
```

### 6. Imports Routes (`apps/api/src/routes/imports.ts`)

**Current behavior:** Returns 400 without Lidarr.

**New behavior:** 
- `preview` and `queue` modes work without Lidarr
- `auto` mode shows error or degrades

### 7. Duplicates Route (`apps/api/src/routes/duplicates.ts`)

**Current behavior:** Returns 400 without Lidarr.

**New behavior:** Keep requiring Lidarr - duplicates detection needs library access.

---

## UI Changes

### 8. Connections Page (`apps/web/src/app/connections/page.tsx`)

No changes needed - users can simply not add Lidarr.

### 9. Subscriptions Page (`apps/web/src/app/subscriptions/page.tsx`)

**Result Handling dropdown:**
- If no Lidarr connection, show "Auto Add" option as disabled
- Tooltip: "Auto-add requires a Lidarr connection"

```tsx
<Select
  value={form.resultHandling}
  onChange={(e) => setForm({ ...form, resultHandling: e.target.value })}
>
  <option value="preview">Preview Only</option>
  <option value="queue">Add to Review Queue</option>
  <option value="auto" disabled={!hasLidarrConnection}>
    Auto Add to Lidarr
  </option>
</Select>
{!hasLidarrConnection && form.resultHandling === 'auto' && (
  <p className="text-xs text-amber-500">
    Auto-add requires a Lidarr connection
  </p>
)}
```

### 10. Search Page (`apps/web/src/app/search/page.tsx`)

**"In Library" badge:**
- Hide entirely when no Lidarr (don't show the badge at all)
- Only render if `result.inLibrary !== undefined`

```tsx
{result.inLibrary !== undefined && (
  <Badge variant={result.inLibrary ? "success" : "default"}>
    {result.inLibrary ? "In Library" : "Not in Library"}
  </Badge>
)}
```

### 11. Discover Page (`apps/web/src/app/discover/page.tsx`)

**When no Lidarr:**
- Show informative message instead of error
- Link to connections page

```tsx
{!hasLidarrConnection && (
  <Card className="p-8 text-center">
    <Library className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
    <h3 className="text-lg font-medium mb-2">Library Connection Required</h3>
    <p className="text-muted-foreground mb-4">
      Discover browses your existing music library to find similar artists. 
      Connect Lidarr to enable this feature.
    </p>
    <Button onClick={() => router.push('/connections')}>
      <Plus className="h-4 w-4 mr-2" /> Add Lidarr Connection
    </Button>
  </Card>
)}
```

### 12. Dashboard/Home

**Optional enhancement:**
- Show status indicator for Lidarr connection
- "Recommendation-only mode" banner when no Lidarr

---

## API Response Changes

### New Error Code

When Lidarr is required but missing:

```json
{
  "error": "Lidarr connection required",
  "code": "LIDARR_REQUIRED",
  "message": "This feature requires an active Lidarr connection"
}
```

### Search Results

**With Lidarr:**
```json
{
  "name": "Artist Name",
  "mbid": "...",
  "inLibrary": true
}
```

**Without Lidarr:**
```json
{
  "name": "Artist Name",
  "mbid": "..."
}
```
(Note: `inLibrary` field is omitted, not `null`)

---

## Database Changes

None required. Existing schema supports this:
- `resultHandling` already has `preview` and `queue` options
- `skipReason` field exists for tracking why items weren't added

---

## Migration/Backwards Compatibility

- No breaking changes
- Existing users with Lidarr: No change in behavior
- New users without Lidarr: Can use subscriptions in preview/queue mode

---

## Testing Considerations

1. **Subscription worker without Lidarr:**
   - `preview` mode works, stores results
   - `queue` mode works, creates review items
   - `auto` mode degrades to `queue`, sets `skipReason`

2. **Search without Lidarr:**
   - Returns results without `inLibrary` field
   - No error thrown

3. **Discover without Lidarr:**
   - Returns clear error with `LIDARR_REQUIRED` code
   - UI shows helpful message

4. **UI with no Lidarr:**
   - Auto-add option disabled
   - In Library badges hidden
   - Discover shows connection prompt

---

## Implementation Order

| Order | Component | Effort |
|-------|-----------|--------|
| 1 | Subscription Worker | 45 min |
| 2 | Import Worker | 30 min |
| 3 | Search Routes | 30 min |
| 4 | Subscription Routes (preview) | 20 min |
| 5 | Imports Routes | 30 min |
| 6 | UI: Subscriptions (disabled option) | 30 min |
| 7 | UI: Search (hide badge) | 15 min |
| 8 | UI: Discover (message) | 20 min |
| 9 | Tests | 1 hour |
| 10 | Documentation | 30 min |

**Total Estimate:** ~5 hours

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Should `auto` mode fail or degrade? | Degrade to `queue` silently |
| Show "In Library" as unknown without Lidarr? | Hide entirely |
| Show disabled options or hide them? | Disabled with tooltips |
