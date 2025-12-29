# AI Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add "AI Search" as a new search type that uses OpenAI/Anthropic to generate artist recommendations from natural language prompts.

**Architecture:** New `/api/search/ai` endpoint calls `AIService.searchByPrompt()`, which sends the user's prompt to configured AI providers, parses the returned artist names, resolves them to MBIDs via Lidarr, enriches with images/stats, and returns results matching the existing artist search format.

**Tech Stack:** Express.js API, existing AIService (OpenAI/Anthropic SDKs), LidarrService, Deezer image fetching, React frontend

---

## Task 1: Add searchByPrompt method to AIService

**Files:**
- Modify: `apps/api/src/services/ai.ts`
- Test: `apps/api/tests/services/ai.test.ts`

**Step 1: Write the failing test**

Create test file if it doesn't exist, add test for `searchByPrompt`:

```typescript
// apps/api/tests/services/ai.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client
vi.mock('../src/lib/db.js', () => ({
  default: {
    aISettings: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

// Mock Anthropic
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

import { AIService } from '../src/services/ai.js';
import prisma from '../src/lib/db.js';

describe('AIService', () => {
  describe('searchByPrompt', () => {
    it('should return empty array when no AI providers configured', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue(null);
      
      const service = new AIService();
      const result = await service.searchByPrompt('chill lo-fi beats');
      
      expect(result).toEqual({ artists: [], providers: [] });
    });

    it('should parse artist names from AI response', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue({
        id: 1,
        openaiApiKey: 'test-key',
        openaiEnabled: true,
        openaiStrategy: 'similar',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      
      const service = new AIService();
      await service.loadSettings();
      
      // The actual OpenAI call is mocked, so we test parsing separately
      const parsed = (service as any).parseArtistList('["Nujabes", "J Dilla", "Madlib"]');
      expect(parsed).toEqual(['Nujabes', 'J Dilla', 'Madlib']);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run tests/services/ai.test.ts -v
```

Expected: FAIL - `searchByPrompt` method not found

**Step 3: Implement searchByPrompt method**

Add to `apps/api/src/services/ai.ts` before the singleton export:

```typescript
  /**
   * Search for artists based on a natural language prompt
   * Used by the AI Search feature on the search page
   */
  async searchByPrompt(
    prompt: string,
    limit: number = 20
  ): Promise<{ artists: string[]; providers: ('openai' | 'anthropic')[] }> {
    if (!this.settings) {
      await this.loadSettings();
    }

    if (!this.settings) {
      return { artists: [], providers: [] };
    }

    const allArtists: string[] = [];
    const usedProviders: ('openai' | 'anthropic')[] = [];

    // Build the prompt for natural language search
    const searchPrompt = `Based on this request: "${prompt}"

Recommend 15-20 music artists that match this description. Consider genre, mood, era, and style.

Return ONLY a JSON array of artist names, nothing else. Format:
["Artist Name 1", "Artist Name 2", ...]`;

    // Try OpenAI if enabled
    if (this.settings.openaiEnabled && this.openaiClient) {
      try {
        const response = await this.openaiClient.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'You are a music expert that recommends artists based on descriptions. Always respond with valid JSON arrays only.',
            },
            { role: 'user', content: searchPrompt },
          ],
          max_tokens: 500,
          temperature: 0.7,
        });

        const content = response.choices[0]?.message?.content || '[]';
        const artists = this.parseArtistList(content);
        allArtists.push(...artists);
        usedProviders.push('openai');
      } catch (error) {
        console.error('[AI Search] OpenAI error:', error);
      }
    }

    // Try Anthropic if enabled
    if (this.settings.anthropicEnabled && this.anthropicClient) {
      try {
        const response = await this.anthropicClient.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 500,
          messages: [{ role: 'user', content: searchPrompt }],
          system: 'You are a music expert that recommends artists based on descriptions. Always respond with valid JSON arrays only.',
        });

        const textBlock = response.content.find((block: { type: string }) => block.type === 'text');
        const content = textBlock && 'text' in textBlock ? textBlock.text : '[]';
        const artists = this.parseArtistList(content);
        allArtists.push(...artists);
        usedProviders.push('anthropic');
      } catch (error) {
        console.error('[AI Search] Anthropic error:', error);
      }
    }

    // Deduplicate artist names (case-insensitive)
    const seen = new Set<string>();
    const uniqueArtists = allArtists.filter(name => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      artists: uniqueArtists.slice(0, limit),
      providers: usedProviders,
    };
  }
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run tests/services/ai.test.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/ai.ts apps/api/tests/services/ai.test.ts
git commit -m "feat(ai): add searchByPrompt method for natural language artist search"
```

---

## Task 2: Create /api/search/ai endpoint

**Files:**
- Modify: `apps/api/src/routes/search.ts`
- Test: `apps/api/tests/api/search-ai.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/tests/api/search-ai.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { searchRouter } from '../../src/routes/search.js';

// Mock dependencies
vi.mock('../../src/lib/db.js', () => ({
  default: {
    connection: { findFirst: vi.fn() },
    aISettings: { findFirst: vi.fn() },
  },
}));

vi.mock('../../src/services/ai.js', () => ({
  aiService: {
    loadSettings: vi.fn(),
    isAvailable: vi.fn(),
    searchByPrompt: vi.fn(),
  },
  AIService: vi.fn(),
}));

vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: vi.fn().mockImplementation(() => ({
    searchArtist: vi.fn(),
  })),
  LidarrCache: vi.fn().mockImplementation(() => ({
    refresh: vi.fn(),
    exists: vi.fn(),
  })),
}));

vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImages: vi.fn().mockResolvedValue(new Map()),
}));

import prisma from '../../src/lib/db.js';
import { aiService } from '../../src/services/ai.js';
import { LidarrService } from '../../src/services/lidarr.js';

const app = express();
app.use(express.json());
// Mock auth middleware
app.use((req, _res, next) => {
  req.user = { id: 1, username: 'test' };
  next();
});
app.use('/api/search', searchRouter);

describe('POST /api/search/ai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if prompt is missing', async () => {
    const res = await request(app)
      .post('/api/search/ai')
      .send({});
    
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('prompt');
  });

  it('should return 400 if AI is not configured', async () => {
    vi.mocked(aiService.isAvailable).mockResolvedValue(false);
    
    const res = await request(app)
      .post('/api/search/ai')
      .send({ prompt: 'chill lo-fi beats' });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('AI');
  });

  it('should return enriched artist results', async () => {
    vi.mocked(aiService.isAvailable).mockResolvedValue(true);
    vi.mocked(aiService.searchByPrompt).mockResolvedValue({
      artists: ['Nujabes', 'J Dilla'],
      providers: ['openai'],
    });
    
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: 1,
      type: 'lidarr',
      config: { url: 'http://localhost', apiKey: 'test' },
    } as any);
    
    const mockLidarr = {
      searchArtist: vi.fn()
        .mockResolvedValueOnce([{ foreignArtistId: 'mbid-1', artistName: 'Nujabes' }])
        .mockResolvedValueOnce([{ foreignArtistId: 'mbid-2', artistName: 'J Dilla' }]),
    };
    vi.mocked(LidarrService).mockImplementation(() => mockLidarr as any);
    
    const res = await request(app)
      .post('/api/search/ai')
      .send({ prompt: 'chill lo-fi beats' });
    
    expect(res.status).toBe(200);
    expect(res.body.prompt).toBe('chill lo-fi beats');
    expect(res.body.results).toHaveLength(2);
    expect(res.body.aiProviders).toContain('openai');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run tests/api/search-ai.test.ts -v
```

Expected: FAIL - endpoint not found (404)

**Step 3: Implement the endpoint**

Add to `apps/api/src/routes/search.ts` after the imports:

```typescript
import { aiService } from '../services/ai.js';
```

Add the endpoint (before the module export or at a logical location with other routes):

```typescript
// AI-powered natural language search
searchRouter.post('/ai', async (req, res) => {
  try {
    const { prompt, limit = 20 } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'Search prompt is required' });
      return;
    }

    // Check if AI is available
    const aiAvailable = await aiService.isAvailable();
    if (!aiAvailable) {
      res.status(400).json({ 
        error: 'AI Search requires OpenAI or Anthropic API keys. Configure in Settings → AI.',
        configured: false,
      });
      return;
    }

    // Get Lidarr service for enrichment
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    // Get AI recommendations
    console.log(`[AI Search] Processing prompt: "${prompt.substring(0, 50)}..."`);
    const { artists: artistNames, providers } = await aiService.searchByPrompt(prompt.trim(), limit);

    if (artistNames.length === 0) {
      res.json({
        prompt: prompt.trim(),
        results: [],
        aiProviders: providers,
        message: 'No recommendations found. Try rephrasing your query.',
      });
      return;
    }

    // Resolve each artist name to MBID via Lidarr search
    const cache = new LidarrCache(lidarr);
    await cache.refresh();

    const enrichedResults = await Promise.all(
      artistNames.map(async (name) => {
        try {
          const searchResults = await lidarr.searchArtist(name);
          if (searchResults.length === 0) {
            console.log(`[AI Search] No Lidarr results for: ${name}`);
            return null;
          }

          const artist = searchResults[0];
          const inLibrary = await cache.exists({ mbid: artist.foreignArtistId });

          return {
            foreignArtistId: artist.foreignArtistId,
            artistName: artist.artistName,
            overview: artist.overview,
            imageUrl: null, // Will be enriched below
            inLibrary,
          };
        } catch (error) {
          console.error(`[AI Search] Error resolving artist "${name}":`, error);
          return null;
        }
      })
    );

    // Filter out nulls (artists that couldn't be resolved)
    const validResults = enrichedResults.filter(r => r !== null);

    // Fetch images from Deezer
    const artistNamesForImages = validResults.map(r => r!.artistName);
    const imageMap = await fetchDeezerArtistImages(artistNamesForImages);

    // Add images to results
    const finalResults = validResults.map(r => ({
      ...r!,
      imageUrl: imageMap.get(r!.artistName) || null,
    }));

    console.log(`[AI Search] Returning ${finalResults.length} results from ${providers.join(', ')}`);

    res.json({
      prompt: prompt.trim(),
      results: finalResults,
      aiProviders: providers,
    });
  } catch (error) {
    console.error('[AI Search] Error:', error);
    const message = error instanceof Error ? error.message : 'AI search failed';
    res.status(500).json({ error: message });
  }
});
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run tests/api/search-ai.test.ts -v
```

Expected: PASS

**Step 5: Run all tests to ensure no regressions**

```bash
cd apps/api && npm test
```

Expected: All tests pass

**Step 6: Commit**

```bash
git add apps/api/src/routes/search.ts apps/api/tests/api/search-ai.test.ts
git commit -m "feat(api): add POST /api/search/ai endpoint for AI-powered search"
```

---

## Task 3: Add AI status endpoint

**Files:**
- Modify: `apps/api/src/routes/search.ts`

**Step 1: Add the endpoint**

Add to `apps/api/src/routes/search.ts`:

```typescript
// Check if AI search is available
searchRouter.get('/ai/status', async (req, res) => {
  try {
    const available = await aiService.isAvailable();
    res.json({ available });
  } catch (error) {
    res.json({ available: false });
  }
});
```

**Step 2: Test manually**

```bash
curl http://localhost:3005/api/search/ai/status -H "Authorization: Bearer <token>"
```

Expected: `{"available": true}` or `{"available": false}`

**Step 3: Commit**

```bash
git add apps/api/src/routes/search.ts
git commit -m "feat(api): add GET /api/search/ai/status endpoint"
```

---

## Task 4: Update SearchType and add AI state in frontend

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`

**Step 1: Update SearchType**

Find the type definition near the top of the file and update:

```typescript
type SearchType = 'artist' | 'album' | 'label' | 'year' | 'ai';
```

**Step 2: Add AI state variables**

Add after the existing state declarations:

```typescript
// AI Search state
const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
const [aiPrompt, setAiPrompt] = useState('');
const [aiProviders, setAiProviders] = useState<string[]>([]);
```

**Step 3: Add useEffect to check AI availability**

Add after other useEffect hooks:

```typescript
// Check AI availability on mount
useEffect(() => {
  const checkAiStatus = async () => {
    const { data } = await api.get<{ available: boolean }>('/api/search/ai/status');
    setAiAvailable(data?.available ?? false);
  };
  checkAiStatus();
}, []);
```

**Step 4: Commit**

```bash
git add apps/web/src/app/search/page.tsx
git commit -m "feat(ui): add AI search type and state variables"
```

---

## Task 5: Add AI Search to dropdown and hide source toggles

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`

**Step 1: Find the search type dropdown**

Locate the search type select/dropdown and add AI option:

```tsx
<Select
  value={searchType}
  onChange={(e) => setSearchType(e.target.value as SearchType)}
>
  <option value="artist">Artist</option>
  <option value="album">Album</option>
  <option value="label">Label</option>
  <option value="year">Year</option>
  <option value="ai" disabled={aiAvailable === false}>
    ✨ AI Search
  </option>
</Select>
```

**Step 2: Conditionally hide source toggles**

Wrap the source toggles section with a condition:

```tsx
{searchType !== 'ai' && (
  <div className="flex flex-wrap gap-2">
    {/* existing source toggle buttons */}
  </div>
)}
```

**Step 3: Show AI unavailable message**

Add below the search type dropdown when AI is selected but unavailable:

```tsx
{searchType === 'ai' && aiAvailable === false && (
  <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 text-center">
    <p className="text-zinc-400 mb-2">AI Search requires OpenAI or Anthropic API keys.</p>
    <a href="/settings" className="text-purple-400 hover:text-purple-300 underline">
      Configure in Settings →
    </a>
  </div>
)}
```

**Step 4: Commit**

```bash
git add apps/web/src/app/search/page.tsx
git commit -m "feat(ui): add AI Search option to dropdown with conditional UI"
```

---

## Task 6: Update search input placeholder and handler

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`

**Step 1: Dynamic placeholder**

Update the search input placeholder:

```tsx
placeholder={
  searchType === 'ai' 
    ? "Describe what you're looking for..." 
    : searchType === 'artist' 
    ? "Search artists..." 
    : searchType === 'album'
    ? "Search albums..."
    : searchType === 'label'
    ? "Search labels..."
    : "Enter year..."
}
```

**Step 2: Update handleSearch for AI**

Find the `handleSearch` function and add AI branch at the beginning:

```typescript
const handleSearch = async () => {
  if (!query.trim()) return;
  
  setIsSearching(true);
  setResults([]);
  setPage(1);

  if (searchType === 'ai') {
    // AI Search flow
    const { data, error } = await api.post<{
      prompt: string;
      results: ArtistResult[];
      aiProviders: string[];
      message?: string;
    }>('/api/search/ai', { prompt: query.trim() });

    if (error) {
      addToast({ type: 'error', title: 'AI Search failed', message: error });
    } else if (data) {
      setAiPrompt(data.prompt);
      setAiProviders(data.aiProviders);
      setResults(data.results);
      setTotalCount(data.results.length);
      
      if (data.results.length === 0) {
        addToast({ type: 'info', title: data.message || 'No results found' });
      }
    }
    setIsSearching(false);
    return;
  }

  // ... existing search logic continues
```

**Step 3: Disable input when AI not available**

Update the input disabled state:

```tsx
disabled={isSearching || (searchType === 'ai' && aiAvailable === false)}
```

**Step 4: Commit**

```bash
git add apps/web/src/app/search/page.tsx
git commit -m "feat(ui): implement AI search handler and dynamic placeholder"
```

---

## Task 7: Add AI results banner

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`

**Step 1: Add results banner**

Find the results section and add the banner before the results grid:

```tsx
{/* AI Results Banner */}
{searchType === 'ai' && results.length > 0 && (
  <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg p-4 mb-4">
    <div className="flex items-center gap-2">
      <span className="text-purple-400 text-lg">✨</span>
      <span className="text-purple-400 font-medium">AI Recommendations for:</span>
      <span className="text-zinc-300">"{aiPrompt}"</span>
    </div>
    {aiProviders.length > 0 && (
      <p className="text-zinc-500 text-sm mt-1">
        Powered by {aiProviders.join(' & ')}
      </p>
    )}
  </div>
)}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/search/page.tsx
git commit -m "feat(ui): add AI recommendations banner with prompt display"
```

---

## Task 8: End-to-end testing

**Step 1: Start the dev stack**

```bash
./start-dev.sh
```

**Step 2: Configure AI (if not already)**

Go to Settings → AI and add an OpenAI or Anthropic API key.

**Step 3: Test AI Search**

1. Navigate to Search page
2. Select "AI Search" from dropdown
3. Verify source toggles disappear
4. Enter: "upbeat indie rock for a road trip"
5. Verify loading state shows
6. Verify results appear with banner
7. Verify "Add to Lidarr" works on results

**Step 4: Test unconfigured state**

1. Disable AI in Settings
2. Refresh Search page
3. Verify AI option is grayed out or shows configuration message

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete AI Search feature implementation"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add `searchByPrompt` method to AIService |
| 2 | Create `/api/search/ai` endpoint |
| 3 | Add `/api/search/ai/status` endpoint |
| 4 | Add AI search type and state to frontend |
| 5 | Add AI to dropdown, hide source toggles when selected |
| 6 | Update search handler for AI flow |
| 7 | Add AI results banner |
| 8 | End-to-end testing |

**Estimated time:** 45-60 minutes
