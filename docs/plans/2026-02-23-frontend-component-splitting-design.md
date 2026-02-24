# Frontend Component Splitting Design

> **Date:** February 23, 2026
> **Branch:** `feature/frontend-component-splitting`
> **Status:** Approved

## Goal

Split two god-components (Connections 1,816 lines, Search 902 lines) into focused sub-components with a wizard-based UX for connections. Test each extraction as we go.

## Decisions

| Decision | Choice |
|----------|--------|
| Connections approach | Full wizard rewrite (layers 1+2+3) |
| Search approach | Component-based tabs (not route-based) |
| Testing strategy | Test as we extract |

---

## Connections Page Architecture

### Component Tree

```
connections/
├── page.tsx                    (~200 lines) Thin orchestrator
├── components/
│   ├── ConnectionCard.tsx      Per-type card in the grid
│   ├── ConnectionWizard.tsx    Multi-step wizard modal
│   ├── WizardStepType.tsx      Step 1: Choose type (card grid)
│   ├── WizardStepConfigure.tsx Step 2: Type-specific form
│   ├── WizardStepTest.tsx      Step 3: Test & save
│   ├── OAuthButtons.tsx        Authorize/Revoke/Preview (Spotify, Deezer, TIDAL)
│   ├── LidarrMaintenance.tsx   Library stats + refresh panel
│   └── forms/
│       ├── LidarrForm.tsx
│       ├── SpotifyForm.tsx
│       ├── LastfmForm.tsx
│       ├── TautulliForm.tsx
│       ├── JellyfinForm.tsx
│       ├── DeezerForm.tsx
│       ├── TidalForm.tsx
│       ├── ListenBrainzForm.tsx
│       ├── DiscogsForm.tsx
│       └── SlskdForm.tsx
└── hooks/
    ├── useOAuthStatus.ts       Shared OAuth status/authorize/revoke for 3 providers
    └── useConnectionForm.ts    Form state + save/update logic
```

### Responsibilities

- **page.tsx** (~200 lines): React Query connections fetch, render ConnectionCard grid, wizard open/close state, OAuth callback handling (URL params → toasts), welcome banner.
- **ConnectionCard**: Renders one type's card — header, connections list with status/actions, OAuthButtons, LidarrMaintenance. Receives callbacks for edit/delete/test.
- **ConnectionWizard**: 3-step modal. Step 1 (choose type) → Step 2 (type-specific form) → Step 3 (test & save). When editing, skips to step 2 with pre-filled data.

### Wizard Flow

| Step | Component | What happens |
|------|-----------|-------------|
| 1. Choose Type | WizardStepType | Grid of 10 type cards. Click selects type, advances to step 2. Skipped when editing. |
| 2. Configure | WizardStepConfigure | Renders the correct forms/<Type>Form.tsx. Each form owns its own local state. Forms with test-then-load (Lidarr, Tautulli, Jellyfin) handle that internally. |
| 3. Test & Save | WizardStepTest | Auto-tests connection on mount. Shows success/failure. Save button calls create/update API. Back button returns to fix config. |

### State Management

- **Wizard-level state**: step, mode (create/edit), selectedType, editingConnection, collected config
- **Per-form state**: each form owns its own useState (no flat mega-object)
- **`useConnectionForm` hook**: handles save/update API, connection name, isGlobal flag
- **`useOAuthStatus` hook**: parameterized by type (`'spotify' | 'deezer' | 'tidal'`), returns `{ status, authorize, revoke, isLoading }`

---

## Search Page Architecture

### Component Tree

```
search/
├── page.tsx                     (~150 lines) Tab switcher + shared search bar
├── components/
│   ├── SearchBar.tsx            Input + type dropdown + source toggles
│   ├── BulkActionBar.tsx        Select all / deselect / "Add N" (shared by artist+AI)
│   ├── ArtistSearch.tsx         Artist grid + multi-select + add logic
│   ├── AlbumSearch.tsx          Album grid + pagination + add-artist-from-album
│   ├── LabelSearch.tsx          Label grid + pagination + label artists modal
│   ├── YearSearch.tsx           Year grid + pagination
│   ├── AISearch.tsx             AI prompt + results grid + multi-select
│   ├── LabelArtistsModal.tsx    Filter, sort, infinite scroll, bulk add
│   └── MbidSelectionModal.tsx   Disambiguation candidate picker
└── hooks/
    ├── useSearch.ts             Shared: query, results, loading, performSearch()
    └── useArtistAdd.ts          Shared: addArtist, addWithMbid, batchAdd
```

### Responsibilities

- **page.tsx** (~150 lines): Renders SearchBar, determines active tab, renders matching search component.
- **useSearch**: Owns query, searchType, results, loading, page, totalResults. Returns typed results.
- **useArtistAdd**: Owns addingArtistId, MBID modal state, add/batch-add handlers, "already exists" detection.
- **Each tab component**: Renders its result grid, manages its own multi-select state (if applicable).

### Key Changes

- Polymorphic `results: any[]` replaced by properly typed discriminated union
- Each form owns its own state instead of shared flat mega-object
- 3 identical OAuth handler sets consolidated into one parameterized hook
- Label artists modal becomes self-contained component

---

## Design Attack Results

- **Rubber-duck**: All data flows traced entry→exit without gaps ✅
- **Attack**: OAuth only on existing connections (not in wizard create flow) — no contradiction ✅
- **Trade-off**: Form remount on wizard back-navigation — acceptable (prevents stale data) ✅
- **Best practices**: Separation of concerns, typed results, no new deps needed ✅
- **Verdict**: Design attack passed — no architectural contradictions found
