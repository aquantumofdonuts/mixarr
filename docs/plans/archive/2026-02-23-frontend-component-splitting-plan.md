# Frontend Component Splitting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split Connections (1,816 lines) and Search (902 lines) god-components into focused sub-components with a wizard-based connections UX, component-based search tabs, and tests for each extraction.

**Architecture:** Connections page becomes thin orchestrator + ConnectionCard grid + 3-step wizard modal with per-type form components. Search page becomes thin orchestrator + tab components with shared hooks. Each extraction includes tests.

**Tech Stack:** Next.js 14 (App Router), React 18, TanStack Query v5, Tailwind CSS + CVA, Vitest + React Testing Library

**Design Document:** `docs/plans/2026-02-23-frontend-component-splitting-design.md`

---

## Phase E1: Connections Page Splitting

### Task E1.1: Extract `useOAuthStatus` Hook

**Files:**
- Create: `apps/web/src/app/connections/hooks/useOAuthStatus.ts`
- Create: `apps/web/src/app/connections/__tests__/useOAuthStatus.test.tsx`

**Goal:** Consolidate the 3 identical OAuth handler sets (Spotify, Deezer, TIDAL) into one parameterized hook.

**Step 1: Create the hook**

Extract the pattern from lines ~294-404 of `connections/page.tsx`. The hook takes `(type: 'spotify' | 'deezer' | 'tidal', connectionId: number | null)` and returns `{ status, authorize, revoke, isLoading }`.

The existing code has these endpoints per type:
- `GET /api/connections/{type}/auth-status/{id}` → status
- `GET /api/connections/{type}/authorize/{id}?baseUrl=...` → redirect URL
- `POST /api/connections/{type}/revoke/{id}` → revoke

The hook should:
1. Fetch auth status when connectionId changes (using React Query or useEffect)
2. Expose `authorize(baseUrl: string)` that gets the auth URL and does `window.location.href = url`
3. Expose `revoke()` that POSTs to revoke and refetches status
4. Track `isLoading` for authorize/revoke operations

**Step 2: Write tests**

Test the hook with `renderHook`. Mock `api.get`/`api.post`. Verify:
- Fetches status when connectionId provided
- Does not fetch when connectionId is null
- `authorize()` calls correct endpoint and redirects
- `revoke()` calls correct endpoint and refetches status
- Type parameter correctly constructs endpoint paths

**Step 3: Verify tests pass**

Run: `cd apps/web && npx vitest run src/app/connections/__tests__/useOAuthStatus.test.tsx`

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: extract useOAuthStatus hook from connections page"
```

---

### Task E1.2: Extract `useConnectionForm` Hook

**Files:**
- Create: `apps/web/src/app/connections/hooks/useConnectionForm.ts`
- Create: `apps/web/src/app/connections/__tests__/useConnectionForm.test.tsx`

**Goal:** Extract the connection create/update/test/delete API logic into a reusable hook.

**Step 1: Create the hook**

Extract from `handleSaveConnection` (lines ~545-635) and `handleTestConnection` / `handleDeleteConnection`. The hook returns:
- `saveConnection(type, name, config, isGlobal, editingId?)` → creates or updates
- `testConnection(id)` → tests existing connection
- `deleteConnection(id)` → deletes with React Query mutation
- `testingId` — ID of connection currently being tested
- `isSaving` — loading state for save

Use `useQueryClient` to invalidate `queryKeys.connections` after mutations.

**Step 2: Write tests**

Mock `api.post`/`api.put`/`api.delete`. Verify:
- `saveConnection` with no editingId calls POST `/api/connections`
- `saveConnection` with editingId calls PUT `/api/connections/{id}`
- `testConnection` calls POST `/api/connections/test/{id}`
- `deleteConnection` calls the delete mutation
- Query cache is invalidated after save/delete
- Toast notifications fired on success/error

**Step 3: Verify tests pass**

Run: `cd apps/web && npx vitest run src/app/connections/__tests__/useConnectionForm.test.tsx`

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: extract useConnectionForm hook from connections page"
```

---

### Task E1.3: Extract `ConnectionCard` Component

**Files:**
- Create: `apps/web/src/app/connections/components/ConnectionCard.tsx`
- Create: `apps/web/src/app/connections/__tests__/ConnectionCard.test.tsx`

**Goal:** Extract the per-type card rendering from the connections grid (lines ~800-1200 of page.tsx).

**Step 1: Create the component**

Props interface:
```typescript
interface ConnectionCardProps {
  typeConfig: { value: string; label: string; color: string; description: string; icon: string };
  connections: Connection[];  // connections filtered to this type
  isAdmin: boolean;
  onAdd: (type: string) => void;
  onEdit: (id: number) => void;
  onTest: (id: number) => void;
  onDelete: (id: number) => void;
  testingId: number | null;
}
```

The card renders:
- Type header with color swatch, icon, label, description
- If no connections: "Configure" button calling `onAdd`
- If connections exist: list of connection entries with status, name, owner badge, action buttons (Test/Edit/Delete)
- For OAuth types (spotify, deezer, tidal): render `OAuthButtons` (extracted in E1.4)
- For lidarr: render `LidarrMaintenance` (extracted in E1.5)

For this task, leave OAuth buttons and Lidarr maintenance as `{/* TODO: OAuthButtons */}` placeholders. They'll be filled in E1.4 and E1.5.

**Step 2: Write tests**

Verify:
- Renders type label and description
- Shows "Configure" button when no connections
- Renders connection name and status for each connection
- Calls onEdit/onDelete/onTest with correct ID when buttons clicked
- Shows loading spinner on the connection whose ID matches testingId
- Shows owner badge (Global/Personal) based on connection.isGlobal

**Step 3: Verify tests pass**

Run: `cd apps/web && npx vitest run src/app/connections/__tests__/ConnectionCard.test.tsx`

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: extract ConnectionCard component"
```

---

### Task E1.4: Extract `OAuthButtons` Component

**Files:**
- Create: `apps/web/src/app/connections/components/OAuthButtons.tsx`
- Create: `apps/web/src/app/connections/__tests__/OAuthButtons.test.tsx`

**Goal:** Extract the OAuth authorize/revoke/preview buttons that appear on Spotify, Deezer, and TIDAL connection cards.

**Step 1: Create the component**

Uses the `useOAuthStatus` hook from E1.1. Props:
```typescript
interface OAuthButtonsProps {
  type: 'spotify' | 'deezer' | 'tidal';
  connectionId: number;
  baseUrl: string;
  onPreview?: (connectionId: number, type: string) => void;  // only for Spotify
}
```

Renders:
- If not authorized: "Authorize" button
- If authorized: status badge + "Preview" button (Spotify only) + "Revoke" button
- If expired/needsReauth: "Re-authorize" button

**Step 2: Write tests**

Mock `useOAuthStatus` hook. Verify:
- Shows Authorize button when status is not authorized
- Shows Revoke button when authorized
- Shows Preview button only for Spotify
- Calls authorize with baseUrl on click
- Calls revoke on click with confirmation

**Step 3: Verify tests pass and commit**

```bash
git add -A && git commit -m "feat: extract OAuthButtons component"
```

---

### Task E1.5: Extract `LidarrMaintenance` Component

**Files:**
- Create: `apps/web/src/app/connections/components/LidarrMaintenance.tsx`
- Create: `apps/web/src/app/connections/__tests__/LidarrMaintenance.test.tsx`

**Goal:** Extract the Lidarr library maintenance panel (stats + refresh buttons) from the connections card.

**Step 1: Create the component**

Extract from lines ~1060-1180 of page.tsx. Props:
```typescript
interface LidarrMaintenanceProps {
  connectionId: number;
}
```

Self-contained: fetches its own stats via `GET /api/connections/lidarr/maintenance/{id}`, manages its own refresh state via `POST /api/connections/lidarr/maintenance/{id}/refresh`.

**Step 2: Write tests**

Mock `api.get`/`api.post`. Verify:
- Fetches and displays library stats (total artists, issues)
- Refresh button calls the correct endpoint
- Shows loading state during refresh

**Step 3: Verify tests pass and commit**

```bash
git add -A && git commit -m "feat: extract LidarrMaintenance component"
```

---

### Task E1.6: Wire `ConnectionCard` + `OAuthButtons` + `LidarrMaintenance` into `page.tsx`

**Files:**
- Modify: `apps/web/src/app/connections/page.tsx`

**Goal:** Replace the inline card rendering in page.tsx with the extracted components. This should remove ~400+ lines from page.tsx.

**Step 1: Import and use new components**

Replace the card grid JSX (lines ~800-1200) with:
```tsx
{connectionTypes.map(type => (
  <ConnectionCard
    key={type.value}
    typeConfig={type}
    connections={connections.filter(c => c.type === type.value)}
    isAdmin={user?.role === 'admin'}
    onAdd={(t) => handleOpenModal(undefined, t)}
    onEdit={(id) => handleOpenModal(id)}
    onTest={(id) => handleTestConnection(id)}
    onDelete={(id) => handleDeleteConnection(id)}
    testingId={testingId}
  />
))}
```

Fill in the `OAuthButtons` and `LidarrMaintenance` placeholders in `ConnectionCard`.

**Step 2: Remove the now-dead code** — OAuth status state, OAuth handler functions, Lidarr maintenance state/handlers from page.tsx. These now live in hooks/components.

**Step 3: Verify the app still works**

Run: `cd apps/web && npx vitest run` (all frontend tests)
Manual: `sudo docker compose up --build -d web` and check connections page visually.

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: wire ConnectionCard into connections page, remove ~400 lines"
```

---

### Task E1.7: Create Per-Type Form Components

**Files:**
- Create: `apps/web/src/app/connections/components/forms/LidarrForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/SpotifyForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/LastfmForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/TautulliForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/JellyfinForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/DeezerForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/TidalForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/ListenBrainzForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/DiscogsForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/SlskdForm.tsx`
- Create: `apps/web/src/app/connections/components/forms/index.ts` (barrel export)

**Goal:** Extract each connection type's form fields from the modal JSX (lines ~1250-1780 of page.tsx) into individual form components.

**Step 1: Define the shared interface**

Each form implements:
```typescript
interface ConnectionFormProps {
  initialConfig?: Record<string, any>;  // pre-filled when editing
  connectionId?: number;                // set when editing (needed for redirect URI display)
  baseUrl: string;                      // for OAuth redirect URI display
  onConfigReady: (config: Record<string, any>) => void;  // called when form is valid
  onConfigInvalid: () => void;          // called when form becomes invalid
}
```

**Step 2: Extract each form**

Each form:
- Owns its own `useState` for its fields (not a shared flat object)
- Pre-populates from `initialConfig` prop when editing
- Calls `onConfigReady(config)` whenever the form is valid (on every change)
- Calls `onConfigInvalid()` when required fields are empty
- Lidarr/Tautulli/Jellyfin forms handle their own "test & load options" flow internally

The barrel export maps type strings to components:
```typescript
export const connectionForms: Record<string, React.ComponentType<ConnectionFormProps>> = {
  lidarr: LidarrForm, spotify: SpotifyForm, /* ... */
};
```

**Step 3: Write tests for 2-3 representative forms**

- Create: `apps/web/src/app/connections/__tests__/forms/LidarrForm.test.tsx`
- Create: `apps/web/src/app/connections/__tests__/forms/SpotifyForm.test.tsx`
- Create: `apps/web/src/app/connections/__tests__/forms/SlskdForm.test.tsx`

Test: renders fields, pre-populates from initialConfig, calls onConfigReady when valid, calls onConfigInvalid when required field is empty. For Lidarr: test "Fetch Options" triggers API call and populates dropdowns.

**Step 4: Verify tests pass and commit**

```bash
git add -A && git commit -m "feat: extract per-type connection form components"
```

---

### Task E1.8: Create `ConnectionWizard` (3-Step Modal)

**Files:**
- Create: `apps/web/src/app/connections/components/ConnectionWizard.tsx`
- Create: `apps/web/src/app/connections/components/WizardStepType.tsx`
- Create: `apps/web/src/app/connections/components/WizardStepConfigure.tsx`
- Create: `apps/web/src/app/connections/components/WizardStepTest.tsx`
- Create: `apps/web/src/app/connections/__tests__/ConnectionWizard.test.tsx`

**Goal:** Build the 3-step wizard modal that replaces the current single-form modal.

**Step 1: Build `WizardStepType`**

Grid of 10 connection type cards (icon, name, description). Click selects type and calls `onSelectType(type)`. Use the existing `connectionTypes` array.

**Step 2: Build `WizardStepConfigure`**

Renders the correct form from `connectionForms[type]`. Also renders:
- Connection name input
- "Global connection" checkbox (if admin)
- Back button (if not editing)
- Next button (enabled only when `onConfigReady` has been called)

**Step 3: Build `WizardStepTest`**

On mount, calls `POST /api/connections` (create) or `PUT /api/connections/{id}` (update) to save, then calls `POST /api/connections/test/{id}` to test. Shows:
- Saving spinner → Test spinner → Success/Failure
- On success: "Connection saved and tested!" + Close button
- On failure: "Connection saved but test failed" + Back button + Close button

**Step 4: Build `ConnectionWizard`**

The orchestrator modal. Props:
```typescript
interface ConnectionWizardProps {
  isOpen: boolean;
  onClose: () => void;
  editingConnection?: Connection | null;  // null = create mode
  preselectedType?: string;               // skip step 1
}
```

Manages: `step` (1/2/3), `selectedType`, `connectionName`, `isGlobal`, `config`.
- Create mode: starts at step 1 (or step 2 if preselectedType)
- Edit mode: starts at step 2 with pre-filled data

Uses `useConnectionForm` hook from E1.2 for save/test.

**Step 5: Write tests**

Verify:
- Create mode starts at step 1 (type selection)
- Clicking a type advances to step 2
- Edit mode starts at step 2 with pre-filled name
- Back button returns to step 1 from step 2
- Next button disabled until form is valid
- Step 3 saves and tests the connection
- onClose called when wizard completes

**Step 6: Verify tests pass and commit**

```bash
git add -A && git commit -m "feat: create ConnectionWizard 3-step modal"
```

---

### Task E1.9: Replace Page Modal with Wizard, Final Cleanup

**Files:**
- Modify: `apps/web/src/app/connections/page.tsx`

**Goal:** Replace the inline modal in page.tsx with `ConnectionWizard`. Remove all remaining dead code. Target: page.tsx ≤ 200 lines.

**Step 1: Replace the modal**

Remove the entire `{showModal && ...}` block (lines ~1220-1800) and the form state/handlers.

Replace with:
```tsx
<ConnectionWizard
  isOpen={showModal}
  onClose={handleCloseModal}
  editingConnection={editingId ? connections.find(c => c.id === editingId) : null}
  preselectedType={preselectedType}
/>
```

**Step 2: Remove dead state and handlers**

Remove from page.tsx: `formData`, `showPassword`, `lidarrData`, `tautulliData`, `tautulliTested`, `jellyfinData`, `jellyfinTested`, `handleSaveConnection`, `handleFetchLidarrOptions`, `handleTestTautulli`, `handleTestJellyfin`, `handleOpenModal` (simplify to just set showModal + editingId), `handleCloseModal` (simplify).

**Step 3: Verify line count and test**

Run: `wc -l apps/web/src/app/connections/page.tsx` — target ≤ 200 lines
Run: `cd apps/web && npx vitest run`
Manual: test create, edit, delete, OAuth flows on the running app.

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: replace connections modal with wizard, page.tsx 1816→~200 lines"
```

---

## Phase E2: Search Page Splitting

### Task E2.1: Extract `useSearch` and `useArtistAdd` Hooks

**Files:**
- Create: `apps/web/src/app/search/hooks/useSearch.ts`
- Create: `apps/web/src/app/search/hooks/useArtistAdd.ts`
- Create: `apps/web/src/app/search/__tests__/useSearch.test.tsx`
- Create: `apps/web/src/app/search/__tests__/useArtistAdd.test.tsx`

**Goal:** Extract shared search and artist-add logic into hooks.

**Step 1: Create `useSearch`**

Owns: `query`, `searchType`, `results`, `loading`, `page`, `totalResults`, `sourcesToggles` (for artist search).
Exposes: `setQuery`, `setSearchType`, `setPage`, `toggleSource`, `performSearch()`.

The `performSearch` function branches on searchType:
- `ai` → POST `/api/search/ai`
- `artist` → GET `/api/search/discover` with source params
- `album` → GET `/api/search/albums`
- `label` → GET `/api/search/labels`
- `year` → GET `/api/search/years`

Returns properly typed results (discriminated by searchType).

**Step 2: Create `useArtistAdd`**

Owns: `addingArtistId`, `mbidCandidates`, `mbidArtist`.
Exposes: `handleAddArtist(artist)`, `handleAddWithMbid(artist, mbid)`, `handleBatchAdd(ids)`, `clearMbidModal()`.

Includes the "already exists" toast detection from the current `isAlreadyExistsError` helper.

**Step 3: Write tests for both hooks**

For `useSearch`: mock `api.get`/`api.post`, verify correct endpoints called per search type, results stored, loading states.
For `useArtistAdd`: mock `api.post`, verify add flows (direct add, MBID disambiguation, batch add), toast calls.

**Step 4: Verify and commit**

```bash
git add -A && git commit -m "feat: extract useSearch and useArtistAdd hooks from search page"
```

---

### Task E2.2: Extract Search Sub-Components

**Files:**
- Create: `apps/web/src/app/search/components/SearchBar.tsx`
- Create: `apps/web/src/app/search/components/BulkActionBar.tsx`
- Create: `apps/web/src/app/search/components/ArtistSearch.tsx`
- Create: `apps/web/src/app/search/components/AlbumSearch.tsx`
- Create: `apps/web/src/app/search/components/LabelSearch.tsx`
- Create: `apps/web/src/app/search/components/YearSearch.tsx`
- Create: `apps/web/src/app/search/components/AISearch.tsx`
- Create: `apps/web/src/app/search/components/MbidSelectionModal.tsx`

**Goal:** Extract each search type into its own component, plus shared SearchBar and BulkActionBar.

**Step 1: Create `SearchBar`**

Props: `query`, `searchType`, `onQueryChange`, `onSearchTypeChange`, `onSearch`, `sourceToggles`, `onToggleSource`, `aiAvailable`.
Renders: type dropdown, search input, search button, source toggles (for artist type only).

**Step 2: Create `BulkActionBar`**

Props: `selectedCount`, `totalCount`, `onSelectAll`, `onDeselectAll`, `onBulkAdd`, `isAdding`.
Renders: Select All / Deselect All / "Add N Selected" buttons.

**Step 3: Create per-type search components**

Each receives results (typed) and the `useArtistAdd` hook's functions as props.

- `ArtistSearch`: renders `ArtistCard` grid, manages local `selectedIds: Set<string>`, uses `BulkActionBar`.
- `AlbumSearch`: renders `AlbumCard` grid with pagination controls.
- `LabelSearch`: renders label cards with pagination, opens `LabelArtistsModal` (E2.3).
- `YearSearch`: renders release cards with pagination. Simplest component.
- `AISearch`: renders AI prompt banner + `ArtistCard` grid with multi-select, uses `BulkActionBar`.

**Step 4: Create `MbidSelectionModal`**

Extract from inline JSX. Props: `candidates`, `artist`, `onSelect(mbid)`, `onClose`.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: extract search sub-components (SearchBar, BulkActionBar, 5 tab components, MbidModal)"
```

---

### Task E2.3: Extract `LabelArtistsModal`

**Files:**
- Create: `apps/web/src/app/search/components/LabelArtistsModal.tsx`
- Create: `apps/web/src/app/search/__tests__/LabelArtistsModal.test.tsx`

**Goal:** Extract the label artists modal (filter, sort, infinite scroll, bulk add) into a self-contained component.

**Step 1: Create the component**

Self-contained: owns its own fetch, filter, sort, infinite scroll state, and multi-select. Props:
```typescript
interface LabelArtistsModalProps {
  label: { name: string; id: string } | null;  // null = closed
  onClose: () => void;
  onArtistAdd: (artist: any) => void;  // uses useArtistAdd externally
}
```

Internally fetches artists via `GET /api/search/labels/{id}/artists`, handles infinite scroll, filter, sort, and batch add.

**Step 2: Write tests**

Verify: renders label name, fetches artists on open, filter narrows list, select/deselect works, batch add calls correct endpoint.

**Step 3: Verify and commit**

```bash
git add -A && git commit -m "feat: extract LabelArtistsModal with infinite scroll"
```

---

### Task E2.4: Wire Search Components into `page.tsx`, Final Cleanup

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`

**Goal:** Replace inline JSX with extracted components. Target: page.tsx ≤ 150 lines.

**Step 1: Replace page.tsx content**

The page becomes:
```tsx
export default function SearchPage() {
  const search = useSearch();
  const artistAdd = useArtistAdd();
  const [slskdOpen, setSlskdOpen] = useState(false);
  const [slskdArtist, setSlskdArtist] = useState(null);

  return (
    <>
      <PageHeader title="Search" />
      <SearchBar {...search} />
      {search.searchType === 'artist' && <ArtistSearch ... />}
      {search.searchType === 'album' && <AlbumSearch ... />}
      {search.searchType === 'label' && <LabelSearch ... />}
      {search.searchType === 'year' && <YearSearch ... />}
      {search.searchType === 'ai' && <AISearch ... />}
      <MbidSelectionModal ... />
      <SlskdSearchModal ... />
    </>
  );
}
```

**Step 2: Remove all dead code from page.tsx**

**Step 3: Verify line count and test**

Run: `wc -l apps/web/src/app/search/page.tsx` — target ≤ 150 lines
Run: `cd apps/web && npx vitest run`
Manual: test all 5 search types, artist add, bulk add, label modal, MBID disambiguation.

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: wire search components, page.tsx 902→~150 lines"
```

---

## Phase E3: Test Coverage (Integrated)

Tests are written with each extraction task above. Summary of test files created:

**Connections (E1):**
1. `useOAuthStatus.test.tsx` (E1.1)
2. `useConnectionForm.test.tsx` (E1.2)
3. `ConnectionCard.test.tsx` (E1.3)
4. `OAuthButtons.test.tsx` (E1.4)
5. `LidarrMaintenance.test.tsx` (E1.5)
6. `forms/LidarrForm.test.tsx` (E1.7)
7. `forms/SpotifyForm.test.tsx` (E1.7)
8. `forms/SlskdForm.test.tsx` (E1.7)
9. `ConnectionWizard.test.tsx` (E1.8)

**Search (E2):**
10. `useSearch.test.tsx` (E2.1)
11. `useArtistAdd.test.tsx` (E2.1)
12. `LabelArtistsModal.test.tsx` (E2.3)

**Total: 12 new test files** (5 existing → 17 total, plus the backend already has 112)

---

## Execution Order

| # | Task | Description | Depends On |
|---|------|-------------|------------|
| 1 | E1.1 | useOAuthStatus hook | — |
| 2 | E1.2 | useConnectionForm hook | — |
| 3 | E1.3 | ConnectionCard component | — |
| 4 | E1.4 | OAuthButtons component | E1.1 |
| 5 | E1.5 | LidarrMaintenance component | — |
| 6 | E1.6 | Wire cards into page.tsx | E1.3, E1.4, E1.5 |
| 7 | E1.7 | Per-type form components | — |
| 8 | E1.8 | ConnectionWizard modal | E1.2, E1.7 |
| 9 | E1.9 | Replace page modal with wizard | E1.6, E1.8 |
| 10 | E2.1 | useSearch + useArtistAdd hooks | — |
| 11 | E2.2 | Search sub-components | E2.1 |
| 12 | E2.3 | LabelArtistsModal | E2.1 |
| 13 | E2.4 | Wire search components | E2.2, E2.3 |

**Note:** E1.1, E1.2, E1.3, E1.5 are independent and can be parallelized. E2.1 can start in parallel with E1 tasks.
