# Issue #29: Enhance Search Results and Search Feature

> **Date:** December 26, 2025  
> **Status:** Approved

## Overview

Two enhancements to the search feature:
1. Add search/sort/filter controls to the label artists modal
2. Improve error handling when adding artists that already exist in Lidarr

---

## Part 1: Label Artists Modal Enhancement

### Features
- **Search input** - Real-time text filtering by artist name (client-side)
- **Sort dropdown** - A-Z, Z-A options (client-side)
- **Infinite scroll** - Load 50 artists initially, fetch more as user scrolls

### UI Layout

```
┌─────────────────────────────────────────────────────┐
│ Label Name                              [Add X] [X] │
│ 150 artists found                                   │
├─────────────────────────────────────────────────────┤
│ [🔍 Search artists...          ] [Sort: A-Z ▼]     │
├─────────────────────────────────────────────────────┤
│ ☐ 🎵 Artist Name 1                                 │
│ ☐ 🎵 Artist Name 2                                 │
│ ☐ 🎵 Artist Name 3                                 │
│ ... (scrolls, loads more at bottom)                 │
│ [Loading more...]                                   │
└─────────────────────────────────────────────────────┘
```

### Behavior
- Search filters already-loaded artists client-side for instant feedback
- Sort reorders client-side (no API call)
- Scroll to bottom triggers next page fetch (offset-based pagination)
- Selection persists across search/sort/scroll operations
- Initial load: 50 artists, subsequent loads: 50 more

### State Management
```typescript
// New state variables
const [labelSearchQuery, setLabelSearchQuery] = useState('');
const [labelSortOrder, setLabelSortOrder] = useState<'asc' | 'desc'>('asc');
const [labelArtistsOffset, setLabelArtistsOffset] = useState(0);
const [hasMoreLabelArtists, setHasMoreLabelArtists] = useState(true);
const [isLoadingMoreArtists, setIsLoadingMoreArtists] = useState(false);
```

### Filtered/Sorted Display
```typescript
const displayedLabelArtists = useMemo(() => {
  let filtered = labelArtists;
  
  // Apply search filter
  if (labelSearchQuery.trim()) {
    const query = labelSearchQuery.toLowerCase();
    filtered = filtered.filter(a => a.name.toLowerCase().includes(query));
  }
  
  // Apply sort
  filtered.sort((a, b) => {
    const cmp = a.name.localeCompare(b.name);
    return labelSortOrder === 'asc' ? cmp : -cmp;
  });
  
  return filtered;
}, [labelArtists, labelSearchQuery, labelSortOrder]);
```

---

## Part 2: Album Search Error Handling

### Current Problem
Raw Lidarr API error shown when artist already exists:
```
Lidarr API error: 400 - [ { "propertyName": "ForeignArtistId", "errorMessage": "This artist has already been added.", ... } ]
```

### Solution
Parse error and show friendly toast:
- **Type:** `info` (not error)
- **Title:** "Already in Library"
- **Message:** `"Artist Name" is already in your Lidarr library`

### Implementation
```typescript
// Check if error is "artist already exists"
if (error.includes('ArtistExistsValidator') || error.includes('already been added')) {
  addToast({ 
    type: 'info', 
    title: 'Already in Library', 
    message: `"${artistName}" is already in your Lidarr library` 
  });
} else {
  addToast({ type: 'error', title: 'Failed to add artist', message: error });
}
```

### Affected Locations
1. `handleAddArtist` function - single artist add from album results
2. Any other place that adds artists and might hit this error

---

## Implementation Tasks

### Task 1: Add state variables for label modal controls
- File: `apps/web/src/app/search/page.tsx`
- Add: `labelSearchQuery`, `labelSortOrder`, `labelArtistsOffset`, `hasMoreLabelArtists`, `isLoadingMoreArtists`

### Task 2: Update loadLabelArtists for pagination
- Modify to accept offset parameter
- Append to existing artists instead of replacing
- Track if more artists available

### Task 3: Add loadMoreLabelArtists function
- Fetch next page of artists
- Append to existing list
- Update offset and hasMore state

### Task 4: Add displayedLabelArtists memo
- Filter by search query
- Sort by selected order
- Return filtered/sorted list

### Task 5: Add search input to modal header
- Text input with search icon
- Debounced onChange handler

### Task 6: Add sort dropdown to modal header
- Options: A-Z, Z-A
- Select component with onChange

### Task 7: Implement infinite scroll
- Add scroll event listener to modal content
- Detect when near bottom
- Trigger loadMoreLabelArtists

### Task 8: Update error handling for album artist add
- Detect ArtistExistsValidator error
- Show friendly info toast
- Keep generic error for other failures

---

## Files to Modify

1. `apps/web/src/app/search/page.tsx` - All frontend changes
