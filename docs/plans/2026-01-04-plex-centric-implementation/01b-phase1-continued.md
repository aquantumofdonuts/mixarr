# Phase 1 Continued: Prowlarr, SABnzbd, slskd Services

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

---

## Task 11: Plex OAuth - Request PIN

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('OAuth', () => {
  describe('requestPin', () => {
    it('should request a PIN from plex.tv', async () => {
      const { PlexService } = await import('../../src/services/plex.js');
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 123456,
          code: 'ABCD1234',
        }),
      });

      const result = await PlexService.requestPin('mixarr-test-client');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://plex.tv/api/v2/pins',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Plex-Client-Identifier': 'mixarr-test-client',
          }),
        })
      );
      expect(result.id).toBe(123456);
      expect(result.code).toBe('ABCD1234');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 3: Implement requestPin as static method**

```typescript
static async requestPin(clientId: string): Promise<{ id: number; code: string }> {
  const response = await fetch('https://plex.tv/api/v2/pins', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'X-Plex-Client-Identifier': clientId,
      'X-Plex-Product': 'Mixarr',
      'X-Plex-Version': '2.0.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to request PIN: ${response.status}`);
  }

  const data = await response.json() as { id: number; code: string };
  return { id: data.id, code: data.code };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add OAuth PIN request"
```

---

## Task 12: Plex OAuth - Check PIN Status

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('checkPin', () => {
  it('should return token when PIN is authorized', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 123456,
        authToken: 'test-auth-token',
      }),
    });

    const result = await PlexService.checkPin(123456, 'mixarr-test-client');

    expect(result.authorized).toBe(true);
    expect(result.authToken).toBe('test-auth-token');
  });

  it('should return not authorized when PIN is pending', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 123456,
        authToken: null,
      }),
    });

    const result = await PlexService.checkPin(123456, 'mixarr-test-client');

    expect(result.authorized).toBe(false);
    expect(result.authToken).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement checkPin**

```typescript
static async checkPin(pinId: number, clientId: string): Promise<{
  authorized: boolean;
  authToken?: string;
}> {
  const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
    headers: {
      'Accept': 'application/json',
      'X-Plex-Client-Identifier': clientId,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to check PIN: ${response.status}`);
  }

  const data = await response.json() as { id: number; authToken: string | null };
  
  if (data.authToken) {
    return { authorized: true, authToken: data.authToken };
  }
  
  return { authorized: false };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add OAuth PIN check"
```

---

## Task 13: Plex OAuth - Get User Servers

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('getServers', () => {
  it('should return list of user servers', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          name: 'My Plex Server',
          product: 'Plex Media Server',
          provides: 'server',
          connections: [
            { uri: 'http://192.168.1.100:32400', local: true },
            { uri: 'https://external.plex.tv:32400', local: false },
          ],
        },
      ]),
    });

    const servers = await PlexService.getServers('test-auth-token', 'mixarr-test-client');

    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('My Plex Server');
    expect(servers[0].connections).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement getServers**

```typescript
export interface PlexServer {
  name: string;
  connections: Array<{ uri: string; local: boolean }>;
}

static async getServers(authToken: string, clientId: string): Promise<PlexServer[]> {
  const response = await fetch('https://plex.tv/api/v2/resources?includeHttps=1', {
    headers: {
      'Accept': 'application/json',
      'X-Plex-Token': authToken,
      'X-Plex-Client-Identifier': clientId,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get servers: ${response.status}`);
  }

  const resources = await response.json() as Array<{
    name: string;
    product: string;
    provides: string;
    connections: Array<{ uri: string; local: boolean }>;
  }>;

  // Filter to only Plex Media Servers
  return resources
    .filter(r => r.provides === 'server')
    .map(r => ({
      name: r.name,
      connections: r.connections,
    }));
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add getServers for OAuth flow"
```

---

## Task 14: Create Prowlarr Service - Base

**Files:**
- Create: `apps/api/src/services/prowlarr.ts`
- Create: `apps/api/tests/services/prowlarr.test.ts`

**Step 1: Write failing test**

```typescript
// apps/api/tests/services/prowlarr.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('Prowlarr Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with valid config', async () => {
      const { ProwlarrService } = await import('../../src/services/prowlarr.js');
      
      const service = new ProwlarrService({
        url: 'http://192.168.1.100:9696',
        apiKey: 'test-api-key',
      });

      expect(service).toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('should return success on valid connection', async () => {
      const { ProwlarrService } = await import('../../src/services/prowlarr.js');
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.0.0' }),
      });

      const service = new ProwlarrService({
        url: 'http://192.168.1.100:9696',
        apiKey: 'test-api-key',
      });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.version).toBe('1.0.0');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/prowlarr.test.ts -v`

**Step 3: Create ProwlarrService**

```typescript
// apps/api/src/services/prowlarr.ts
/**
 * Prowlarr Service
 * 
 * Handles interactions with Prowlarr for indexer searching.
 */

import { rateLimit } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Prowlarr');

export interface ProwlarrConfig {
  url: string;
  apiKey: string;
}

export interface ProwlarrSearchResult {
  guid: string;
  title: string;
  indexer: string;
  size: number;
  publishDate: string;
  downloadUrl: string;
  infoUrl?: string;
  categories: Array<{ id: number; name: string }>;
}

export class ProwlarrService {
  private url: string;
  private apiKey: string;

  constructor(config: ProwlarrConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  private async request<T>(endpoint: string): Promise<T> {
    await rateLimit('prowlarr');

    const response = await fetch(`${this.url}/api/v1${endpoint}`, {
      headers: {
        'X-Api-Key': this.apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Prowlarr API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<{
    success: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      const response = await this.request<{ version: string }>('/system/status');
      return { success: true, version: response.version };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/prowlarr.ts apps/api/tests/services/prowlarr.test.ts
git commit -m "feat(prowlarr): add ProwlarrService with testConnection"
```

---

## Task 15: Prowlarr Service - Search

**Files:**
- Modify: `apps/api/src/services/prowlarr.ts`
- Modify: `apps/api/tests/services/prowlarr.test.ts`

**Step 1: Write failing test**

```typescript
describe('search', () => {
  it('should search for music releases', async () => {
    const { ProwlarrService } = await import('../../src/services/prowlarr.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          guid: 'abc123',
          title: 'Pink Floyd - The Dark Side of the Moon (1973) [FLAC]',
          indexer: 'NZBgeek',
          size: 935000000,
          publishDate: '2024-01-01T00:00:00Z',
          downloadUrl: 'https://example.com/download/abc123',
          categories: [{ id: 3010, name: 'Audio/MP3' }],
        },
      ]),
    });

    const service = new ProwlarrService({
      url: 'http://192.168.1.100:9696',
      apiKey: 'test-api-key',
    });

    const results = await service.search('Pink Floyd Dark Side of the Moon');

    expect(results).toHaveLength(1);
    expect(results[0].title).toContain('Pink Floyd');
    expect(results[0].indexer).toBe('NZBgeek');
  });

  it('should filter to music categories', async () => {
    const { ProwlarrService } = await import('../../src/services/prowlarr.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const service = new ProwlarrService({
      url: 'http://192.168.1.100:9696',
      apiKey: 'test-api-key',
    });

    await service.search('Pink Floyd', { musicOnly: true });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('categories=3000'),
      expect.any(Object)
    );
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement search**

```typescript
async search(
  query: string,
  options?: { musicOnly?: boolean; limit?: number }
): Promise<ProwlarrSearchResult[]> {
  const params = new URLSearchParams({
    query,
    type: 'search',
  });

  if (options?.musicOnly) {
    params.append('categories', '3000'); // Music category
  }

  if (options?.limit) {
    params.append('limit', options.limit.toString());
  }

  const results = await this.request<Array<{
    guid: string;
    title: string;
    indexer: string;
    size: number;
    publishDate: string;
    downloadUrl: string;
    infoUrl?: string;
    categories: Array<{ id: number; name: string }>;
  }>>(`/search?${params}`);

  return results.map(r => ({
    guid: r.guid,
    title: r.title,
    indexer: r.indexer,
    size: r.size,
    publishDate: r.publishDate,
    downloadUrl: r.downloadUrl,
    infoUrl: r.infoUrl,
    categories: r.categories,
  }));
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/prowlarr.ts apps/api/tests/services/prowlarr.test.ts
git commit -m "feat(prowlarr): add search method"
```

---

## Task 16: Create SABnzbd Service - Base

**Files:**
- Create: `apps/api/src/services/sabnzbd.ts`
- Create: `apps/api/tests/services/sabnzbd.test.ts`

**Step 1: Write failing test**

```typescript
// apps/api/tests/services/sabnzbd.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('SABnzbd Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with valid config', async () => {
      const { SabnzbdService } = await import('../../src/services/sabnzbd.js');
      
      const service = new SabnzbdService({
        url: 'http://192.168.1.100:8080',
        apiKey: 'test-api-key',
      });

      expect(service).toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('should return success on valid connection', async () => {
      const { SabnzbdService } = await import('../../src/services/sabnzbd.js');
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: true,
          version: '3.7.0',
        }),
      });

      const service = new SabnzbdService({
        url: 'http://192.168.1.100:8080',
        apiKey: 'test-api-key',
      });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.version).toBe('3.7.0');
    });
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Create SabnzbdService**

```typescript
// apps/api/src/services/sabnzbd.ts
/**
 * SABnzbd Service
 * 
 * Handles interactions with SABnzbd for Usenet downloads.
 */

import { rateLimit } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('SABnzbd');

export interface SabnzbdConfig {
  url: string;
  apiKey: string;
  category?: string;
  remotePath?: string;  // Path SABnzbd reports
  localPath?: string;   // Path Mixarr sees
}

export interface SabnzbdQueueItem {
  nzo_id: string;
  filename: string;
  status: string;
  percentage: string;
  timeleft: string;
  mb: string;
  mbleft: string;
}

export interface SabnzbdHistoryItem {
  nzo_id: string;
  name: string;
  status: string;
  storage: string;  // Path where files were extracted
  completed: number;
  bytes: number;
}

export class SabnzbdService {
  private url: string;
  private apiKey: string;
  private category?: string;
  private remotePath?: string;
  private localPath?: string;

  constructor(config: SabnzbdConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.category = config.category;
    this.remotePath = config.remotePath;
    this.localPath = config.localPath;
  }

  private async request<T>(mode: string, params?: Record<string, string>): Promise<T> {
    await rateLimit('sabnzbd');

    const url = new URL(`${this.url}/api`);
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('mode', mode);
    url.searchParams.set('output', 'json');

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`SABnzbd API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<{
    success: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      const response = await this.request<{ status: boolean; version: string }>('version');
      return { success: true, version: response.version };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/sabnzbd.ts apps/api/tests/services/sabnzbd.test.ts
git commit -m "feat(sabnzbd): add SabnzbdService with testConnection"
```

---

## Task 17: SABnzbd Service - Add NZB by URL

**Files:**
- Modify: `apps/api/src/services/sabnzbd.ts`
- Modify: `apps/api/tests/services/sabnzbd.test.ts`

**Step 1: Write failing test**

```typescript
describe('addByUrl', () => {
  it('should add NZB by URL and return nzo_id', async () => {
    const { SabnzbdService } = await import('../../src/services/sabnzbd.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: true,
        nzo_ids: ['SABnzbd_nzo_abc123'],
      }),
    });

    const service = new SabnzbdService({
      url: 'http://192.168.1.100:8080',
      apiKey: 'test-api-key',
      category: 'music',
    });

    const result = await service.addByUrl('https://example.com/download/nzb123');

    expect(result.success).toBe(true);
    expect(result.nzoId).toBe('SABnzbd_nzo_abc123');
  });

  it('should include category in request', async () => {
    const { SabnzbdService } = await import('../../src/services/sabnzbd.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: true,
        nzo_ids: ['SABnzbd_nzo_abc123'],
      }),
    });

    const service = new SabnzbdService({
      url: 'http://192.168.1.100:8080',
      apiKey: 'test-api-key',
      category: 'music',
    });

    await service.addByUrl('https://example.com/nzb');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('cat=music'),
    );
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement addByUrl**

```typescript
async addByUrl(nzbUrl: string, name?: string): Promise<{
  success: boolean;
  nzoId?: string;
  error?: string;
}> {
  try {
    const params: Record<string, string> = { name: nzbUrl };
    
    if (this.category) {
      params.cat = this.category;
    }
    
    if (name) {
      params.nzbname = name;
    }

    const response = await this.request<{
      status: boolean;
      nzo_ids?: string[];
      error?: string;
    }>('addurl', params);

    if (response.status && response.nzo_ids?.length) {
      log.info(`Added NZB to SABnzbd: ${response.nzo_ids[0]}`);
      return { success: true, nzoId: response.nzo_ids[0] };
    }

    return { success: false, error: response.error || 'Unknown error' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add NZB',
    };
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/sabnzbd.ts apps/api/tests/services/sabnzbd.test.ts
git commit -m "feat(sabnzbd): add addByUrl method"
```

---

## Task 18: SABnzbd Service - Get Queue and History

**Files:**
- Modify: `apps/api/src/services/sabnzbd.ts`
- Modify: `apps/api/tests/services/sabnzbd.test.ts`

**Step 1: Write failing test**

```typescript
describe('getQueue', () => {
  it('should return queue items', async () => {
    const { SabnzbdService } = await import('../../src/services/sabnzbd.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        queue: {
          slots: [
            {
              nzo_id: 'abc123',
              filename: 'Pink.Floyd.DSOTM.FLAC',
              status: 'Downloading',
              percentage: '45',
              timeleft: '00:15:30',
              mb: '892.5',
              mbleft: '491.4',
            },
          ],
        },
      }),
    });

    const service = new SabnzbdService({
      url: 'http://192.168.1.100:8080',
      apiKey: 'test-api-key',
    });

    const queue = await service.getQueue();

    expect(queue).toHaveLength(1);
    expect(queue[0].nzo_id).toBe('abc123');
    expect(queue[0].percentage).toBe('45');
  });
});

describe('getHistory', () => {
  it('should return history items', async () => {
    const { SabnzbdService } = await import('../../src/services/sabnzbd.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        history: {
          slots: [
            {
              nzo_id: 'abc123',
              name: 'Pink.Floyd.DSOTM.FLAC',
              status: 'Completed',
              storage: '/downloads/complete/Pink.Floyd.DSOTM.FLAC',
              completed: 1700000000,
              bytes: 935000000,
            },
          ],
        },
      }),
    });

    const service = new SabnzbdService({
      url: 'http://192.168.1.100:8080',
      apiKey: 'test-api-key',
    });

    const history = await service.getHistory();

    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('Completed');
    expect(history[0].storage).toContain('Pink.Floyd');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement getQueue and getHistory**

```typescript
async getQueue(): Promise<SabnzbdQueueItem[]> {
  const response = await this.request<{
    queue: { slots: SabnzbdQueueItem[] };
  }>('queue');

  return response.queue.slots || [];
}

async getHistory(limit: number = 50): Promise<SabnzbdHistoryItem[]> {
  const response = await this.request<{
    history: { slots: SabnzbdHistoryItem[] };
  }>('history', { limit: limit.toString() });

  return response.history.slots || [];
}

async getItemStatus(nzoId: string): Promise<{
  found: boolean;
  status?: 'queued' | 'downloading' | 'completed' | 'failed';
  path?: string;
  percentage?: number;
}> {
  // Check queue first
  const queue = await this.getQueue();
  const queueItem = queue.find(item => item.nzo_id === nzoId);
  
  if (queueItem) {
    return {
      found: true,
      status: queueItem.status === 'Downloading' ? 'downloading' : 'queued',
      percentage: parseFloat(queueItem.percentage),
    };
  }

  // Check history
  const history = await this.getHistory();
  const historyItem = history.find(item => item.nzo_id === nzoId);
  
  if (historyItem) {
    const localPath = this.translatePath(historyItem.storage);
    return {
      found: true,
      status: historyItem.status === 'Completed' ? 'completed' : 'failed',
      path: localPath,
    };
  }

  return { found: false };
}

private translatePath(remotePath: string): string {
  if (this.remotePath && this.localPath) {
    return remotePath.replace(this.remotePath, this.localPath);
  }
  return remotePath;
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/sabnzbd.ts apps/api/tests/services/sabnzbd.test.ts
git commit -m "feat(sabnzbd): add getQueue, getHistory, getItemStatus methods"
```

---

## Task 19: Create slskd Service - Base

**Files:**
- Create: `apps/api/src/services/slskd.ts`
- Create: `apps/api/tests/services/slskd.test.ts`

**Step 1: Write failing test**

```typescript
// apps/api/tests/services/slskd.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('slskd Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with valid config', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const service = new SlskdService({
        url: 'http://192.168.1.100:5030',
        apiKey: 'test-api-key',
      });

      expect(service).toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('should return success on valid connection', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          version: '0.21.0',
          isConnected: true,
        }),
      });

      const service = new SlskdService({
        url: 'http://192.168.1.100:5030',
        apiKey: 'test-api-key',
      });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.version).toBe('0.21.0');
    });
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Create SlskdService**

```typescript
// apps/api/src/services/slskd.ts
/**
 * slskd Service
 * 
 * Handles interactions with slskd for Soulseek downloads.
 */

import { rateLimit } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('slskd');

export interface SlskdConfig {
  url: string;
  apiKey: string;
  remotePath?: string;
  localPath?: string;
}

export interface SlskdSearchResult {
  username: string;
  files: Array<{
    filename: string;
    size: number;
    bitRate?: number;
    sampleRate?: number;
    bitDepth?: number;
  }>;
  freeUploadSlots: number;
  uploadSpeed: number;
}

export interface SlskdDownload {
  id: string;
  username: string;
  filename: string;
  state: 'Requested' | 'Queued' | 'Downloading' | 'Completed' | 'Errored';
  percentComplete: number;
  bytesDownloaded: number;
  size: number;
}

export class SlskdService {
  private url: string;
  private apiKey: string;
  private remotePath?: string;
  private localPath?: string;

  constructor(config: SlskdConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.remotePath = config.remotePath;
    this.localPath = config.localPath;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    await rateLimit('slskd');

    const response = await fetch(`${this.url}/api/v0${endpoint}`, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`slskd API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<{
    success: boolean;
    version?: string;
    connected?: boolean;
    error?: string;
  }> {
    try {
      const response = await this.request<{ version: string; isConnected: boolean }>('/application');
      return {
        success: true,
        version: response.version,
        connected: response.isConnected,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/slskd.ts apps/api/tests/services/slskd.test.ts
git commit -m "feat(slskd): add SlskdService with testConnection"
```

---

## Task 20: slskd Service - Search

**Files:**
- Modify: `apps/api/src/services/slskd.ts`
- Modify: `apps/api/tests/services/slskd.test.ts`

**Step 1: Write failing test**

```typescript
describe('search', () => {
  it('should search for files and return results', async () => {
    const { SlskdService } = await import('../../src/services/slskd.js');
    
    // First call: start search
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'search-123' }),
    });
    
    // Second call: get results
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        state: 'Completed',
        responses: [
          {
            username: 'user123',
            files: [
              { filename: 'Pink Floyd - DSOTM.flac', size: 935000000 },
            ],
            freeUploadSlots: 5,
            uploadSpeed: 1000000,
          },
        ],
      }),
    });

    const service = new SlskdService({
      url: 'http://192.168.1.100:5030',
      apiKey: 'test-api-key',
    });

    const results = await service.search('Pink Floyd Dark Side of the Moon');

    expect(results).toHaveLength(1);
    expect(results[0].username).toBe('user123');
    expect(results[0].files).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement search**

```typescript
async search(query: string, timeout: number = 30000): Promise<SlskdSearchResult[]> {
  // Start the search
  const searchResponse = await this.request<{ id: string }>('/searches', {
    method: 'POST',
    body: JSON.stringify({ searchText: query }),
  });

  const searchId = searchResponse.id;
  
  // Poll for results
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const results = await this.request<{
      state: string;
      responses: SlskdSearchResult[];
    }>(`/searches/${searchId}`);

    if (results.state === 'Completed' || results.responses.length > 0) {
      return results.responses;
    }

    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Return whatever we have after timeout
  const finalResults = await this.request<{
    responses: SlskdSearchResult[];
  }>(`/searches/${searchId}`);
  
  return finalResults.responses;
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/slskd.ts apps/api/tests/services/slskd.test.ts
git commit -m "feat(slskd): add search method"
```

---

## Tasks 21-25: slskd Download and Status Methods

Similar pattern to SABnzbd - implement:
- `downloadFiles(username, files)` - queue files for download
- `getDownloads()` - get all active downloads
- `getDownloadStatus(id)` - check specific download
- `cancelDownload(id)` - cancel a download

---

## Tasks 26-30: Update Rate Limiter

**Files:**
- Modify: `apps/api/src/services/rate-limiter.ts`

Add rate limit configurations for new services:

```typescript
const rateLimits: Record<string, { requests: number; windowMs: number }> = {
  // Existing...
  plex: { requests: 20, windowMs: 1000 },      // 20/sec
  prowlarr: { requests: 10, windowMs: 1000 },  // 10/sec
  sabnzbd: { requests: 10, windowMs: 1000 },   // 10/sec
  slskd: { requests: 10, windowMs: 1000 },     // 10/sec
};
```

---

## Tasks 31-40: Connection Routes

Add routes for new connection types in `apps/api/src/routes/connections.ts`:
- Plex OAuth endpoints (request PIN, check PIN, get servers)
- Test connection for each new type
- CRUD operations (create, update, delete)
- Update frontend connection type definitions

---

## Tasks 41-45: Integration Tests

Create `apps/api/tests/e2e/connections.test.ts`:
- Test Plex OAuth flow end-to-end
- Test Prowlarr search with mocked indexer
- Test SABnzbd add and status check
- Test slskd search and download

---

See [02-phase2-discography.md](02-phase2-discography.md) for Phase 2.
