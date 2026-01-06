# AI Search Feature Design

> **Date:** 2025-12-28  
> **Status:** Approved  
> **For Implementation:** Use superpowers:writing-plans to create detailed implementation plan

## Overview

Add an "AI Search" mode to the existing Search page where users can describe what music they want in natural language (e.g., "playlist for a teenager's birthday party") and receive AI-generated artist recommendations displayed in the standard search results format.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Result enrichment | AI generates names → enrich via Lidarr/MusicBrainz for images, stats, library status |
| Input style | Simple text field (natural language, no parameters) |
| UI integration | New search type in dropdown (Artist/Album/Label/Year/**AI Search**) |
| Unconfigured state | Grayed out option with tooltip: "Configure in Settings → AI" |
| Results display | Header banner showing original prompt, standard artist cards below |

## User Experience Flow

### Entry Point
- Search type dropdown gains 5th option: **"AI Search"** (with ✨ icon)
- When selected:
  - Source toggles (Spotify, Deezer, etc.) disappear
  - Search placeholder: *"Describe what you're looking for..."*
  - If no AI configured: search disabled with message linking to Settings

### Search Flow
1. User types natural language query (e.g., "chill lo-fi beats for studying")
2. Presses Enter or clicks Search
3. Loading state: "Asking AI for recommendations..."
4. Results appear with gradient banner: *"✨ AI Recommendations for: 'chill lo-fi beats for studying'"*
5. Standard artist cards with image, name, genres, stats, "Add to Lidarr" button

### Result Actions
- Same as regular artist search: Add to Lidarr, bulk select, view details
- "In Library" badge shows if artist already exists

## API Design

### New Endpoint

```
POST /api/search/ai
```

**Request:**
```json
{
  "prompt": "chill lo-fi beats for studying",
  "limit": 20
}
```

**Response:**
```json
{
  "prompt": "chill lo-fi beats for studying",
  "results": [
    {
      "foreignArtistId": "mbid-here",
      "artistName": "Nujabes",
      "overview": "Japanese producer...",
      "imageUrl": "https://...",
      "inLibrary": false,
      "aiSource": "anthropic"
    }
  ],
  "aiProviders": ["openai", "anthropic"]
}
```

### Backend Flow
1. **Check AI availability** - Return 400 if no AI providers configured
2. **Call AI providers** - Use existing `AIService` with custom prompt
3. **Parse AI response** - Extract artist names from JSON array
4. **Resolve to MBIDs** - Search Lidarr for each artist name
5. **Enrich results** - Get images (Deezer), stats (Last.fm), library status
6. **Return unified results** - Same format as `/api/search/artists`

### AI Prompt Template
```
Based on this request: "{user_prompt}"

Recommend 15-20 music artists that match this description.
Return ONLY a JSON array of artist names, nothing else.
Format: ["Artist 1", "Artist 2", ...]
```

## Frontend Changes

### Search Page Updates (`apps/web/src/app/search/page.tsx`)

**State Changes:**
- Add `'ai'` to `SearchType`
- Add `aiPrompt` state for banner display
- Add `aiAvailable` state (fetched on mount)

**UI Changes:**
1. Search type dropdown - Add "AI Search" option with sparkle icon
2. Conditional source toggles - Hide when `searchType === 'ai'`
3. Dynamic input placeholder based on search type
4. Disabled state when AI not configured
5. Results banner for AI results
6. Search handler branches to `/api/search/ai`

### Results Banner Component
```tsx
{searchType === 'ai' && results.length > 0 && (
  <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg p-3 mb-4">
    <span className="text-purple-400">✨ AI Recommendations for:</span>
    <span className="ml-2 text-zinc-300">"{aiPrompt}"</span>
  </div>
)}
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| No AI configured | Dropdown option grayed out, tooltip |
| AI API error | Toast: "AI service unavailable. Try again later." |
| AI returns no results | Message: "No recommendations found. Try rephrasing your query." |
| Artist not found in Lidarr/MB | Skip that artist, continue with others |
| Empty prompt submitted | Validation: "Please describe what you're looking for" |
| Rate limiting | Inherit existing API rate limiting |

## Performance Considerations

- AI calls can be slow (2-5s) - loading state is critical
- Enrichment parallelized via Promise.all
- Results not cached (queries are unique natural language)
- Limit to 20 results max for fast enrichment

## Testing Strategy

- Unit tests for AI prompt parsing
- Integration tests for `/api/search/ai` endpoint
- Mock AI responses in tests (no real API calls)
- Frontend component tests for conditional UI states

## Files to Modify

### Backend
- `apps/api/src/routes/search.ts` - Add `/ai` endpoint
- `apps/api/src/services/ai.ts` - Add `searchByPrompt()` method

### Frontend  
- `apps/web/src/app/search/page.tsx` - Add AI search type and UI logic

### Tests
- `apps/api/tests/api/search.test.ts` - AI endpoint tests
