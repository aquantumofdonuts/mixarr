import { test as base, expect, type Page } from '@playwright/test';
import type { FeedItem } from '../src/lib/hooks';

export const CATALOG_USER = { id: 7, username: 'catalog-reader', displayName: 'Catalog Reader', role: 'admin' as const };
export const ARTIST_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const recordedAt = '2026-10-07T12:00:00.000Z';
const artwork = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#DEE1E4"/><circle cx="50" cy="50" r="30" fill="#494F55"/><circle cx="50" cy="50" r="6" fill="#DEE1E4"/></svg>')}`;

export const catalogFeed: FeedItem[] = [
  { id: 'feed-1-2', artistName: 'Common Name', artistMbid: ARTIST_IDS[0], imageUrl: artwork, score: 2, subscriptionCount: 2, sourceCount: 2, sources: ['lastfm', 'listenbrainz'], createdAt: recordedAt, tags: ['jazz'], listeners: 13000, subscriptionName: 'Weekly discoveries', status: 'pending' },
  { id: 'feed-3', artistName: 'Common Name', artistMbid: ARTIST_IDS[1], imageUrl: null, score: 1, subscriptionCount: 1, sourceCount: 1, sources: ['lastfm'], createdAt: recordedAt, tags: null, listeners: null, subscriptionName: 'Second source', status: 'pending' },
  { id: 'feed-4', artistName: 'Unidentified Ensemble with a Very Long Name and Collaborator Credits', artistMbid: null, imageUrl: null, score: 1, subscriptionCount: 1, sourceCount: 1, sources: ['spotify'], createdAt: recordedAt, tags: null, listeners: null, subscriptionName: null, status: 'pending' },
];

// ponytail: generate the full dataset; the mock applies the API's actual page limit.
export const catalogQueue = Array.from({ length: 520 }, (_, index) => ({
  id: index + 1, userId: CATALOG_USER.id, artistName: `Queue Artist ${String(index + 1).padStart(3, '0')}`,
  albumName: null, releaseYear: null, spotifyId: null, mbid: index % 3 ? ARTIST_IDS[index % 2] : null,
  source: 'Weekly discoveries', status: 'pending', itemType: 'artist', createdAt: recordedAt, imageUrl: null,
}));

interface CatalogFixtures {
  catalogPage: Page;
  catalogRole: 'admin' | 'user';
  catalogScenario: 'ready' | 'empty' | 'error' | 'add-failed';
  catalogAuthenticated: boolean;
}

export const test = base.extend<CatalogFixtures>({
  serviceWorkers: 'block',
  catalogRole: ['admin', { option: true }],
  catalogScenario: ['ready', { option: true }],
  catalogAuthenticated: [true, { option: true }],
  catalogPage: async ({ page, catalogRole, catalogScenario, catalogAuthenticated }, use) => {
    let authenticated = catalogAuthenticated;
    const user = { ...CATALOG_USER, role: catalogRole };
    const items = catalogScenario === 'empty' ? [] : [...catalogFeed];
    const queue = catalogScenario === 'empty' ? [] : [...catalogQueue];
    const added = new Set<string>();
    const unhandled: string[] = [];
    await page.context().route(/\/api\//, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
      if (method === 'GET') {
        switch (path) {
          case '/api/auth/me': return reply({ user: authenticated ? user : null, setupRequired: false });
          case '/api/auth/setup-required': return reply({ setupRequired: false });
          case '/api/auth/sso/enabled': return reply({ providers: [] });
          case '/api/health/live': return reply({ status: 'ok', version: '2.3.5', update: null });
          case '/api/feed': {
            if (catalogScenario === 'error') return reply({ error: 'Catalog source unavailable' }, 503);
            const offset = Number(url.searchParams.get('offset') || 0);
            const limit = Number(url.searchParams.get('limit') || 50);
            return reply({ items: items.slice(offset, offset + limit).map(({ status: _status, ...item }) => item), total: items.length, stats: { pending: items.length, addedToday: 0 } });
          }
          case '/api/dashboard/stats': return reply({ stats: { activeSubscriptions: 1, artistsAdded: 0, pendingReviews: queue.length, runningJobs: 0, activeConnections: 1 } });
          case '/api/search/ai/status': return reply({ available: false });
          case '/api/search/lidarr/artists': return reply({ artists: [], total: 0, needingRefresh: 0, issueStats: { noAlbums: 0, noPoster: 0, noOverview: 0, noGenres: 0 }, healthScore: 100 });
          case '/api/search/discover': return reply({ results: catalogScenario === 'empty' ? [] : catalogFeed.map((item, index) => ({ name: item.artistName, mbid: item.artistMbid, imageUrl: item.imageUrl, sources: item.sources, spotifyId: `fixture-${index}`, inLibrary: added.has(item.artistMbid || '') })) });
          case '/api/subscriptions': return reply({ subscriptions: catalogScenario === 'empty' ? [] : [{ id: 11, userId: user.id, name: 'Weekly discoveries', type: 'lastfm_similar', config: { artist: 'Common Name' }, schedule: '0 0 * * 0', resultHandling: 'queue', isActive: true, lastRun: recordedAt, lastRunStatus: 'completed', lastRunCount: 3, nextRun: null }] });
          case '/api/subscriptions/presets/list': return reply({ presets: [] });
          case '/api/connections/has-lidarr': return reply({ hasLidarr: true });
          case '/api/connections': return reply({ connections: catalogScenario === 'empty' ? [] : [{ id: 1, userId: user.id, type: 'lidarr', name: 'Catalog Lidarr', isActive: true, lastTest: null, createdAt: recordedAt }] });
          case '/api/imports/review/queue': {
            const matches = queue.filter(item => item.status === (url.searchParams.get('status') || 'pending') && (!url.searchParams.has('itemType') || item.itemType === url.searchParams.get('itemType')));
            return reply({ items: matches.slice(0, Number(url.searchParams.get('limit') || 50)), total: matches.length });
          }
          case '/api/slskd/downloads': return reply(catalogScenario === 'empty' ? [] : [{ id: 1, connectionId: 1, username: 'fixture-peer', artistName: 'Common Name', filename: 'record.flac', fileSize: 1024, status: 'failed', error: 'Fixture transfer interrupted', createdAt: recordedAt, updatedAt: recordedAt }]);
          case '/api/settings':
          case '/api/settings/global': return reply({ settings: {} });
          case '/api/ai/settings': return reply({ settings: { openaiEnabled: false, openaiConfigured: false, anthropicEnabled: false, anthropicConfigured: false } });
          case '/api/sso/providers': return reply({ providers: [] });
          case '/api/settings/base-url': return reply({ baseUrl: 'http://localhost' });
        }
      }
      if (method === 'POST') {
        if (path === '/api/auth/login') {
          const body = request.postDataJSON();
          if (body.username !== user.username || body.password !== 'catalog-fixture-password') return reply({ error: 'Invalid username or password' }, 401);
          authenticated = true;
          return reply({ user, setupRequired: false });
        }
        if (path === '/api/search/artists/add') {
          const body = request.postDataJSON();
          if (!ARTIST_IDS.includes(body.foreignArtistId)) return reply({ error: 'Unknown fixture identity' }, 422);
          if (catalogScenario === 'add-failed') return reply({ error: 'Lidarr fixture unavailable' }, 503);
          added.add(body.foreignArtistId);
          return reply({ success: true, artist: { foreignArtistId: body.foreignArtistId } });
        }
        if (/^\/api\/feed\/[^/]+\/(approve|dismiss)$/.test(path)) {
          const id = decodeURIComponent(path.split('/')[3]);
          const index = items.findIndex(item => item.id === id);
          if (index < 0) return reply({ error: 'Not found' }, 404);
          const item = items[index];
          if (path.endsWith('/approve')) {
            if (!item.artistMbid) return reply({ error: 'Choose an artist identity', code: 'IDENTITY_REQUIRED' }, 422);
            if (catalogScenario === 'add-failed') {
              items[index] = { ...item, acquisitionState: 'uncertain' };
              return reply({ success: false, artistName: item.artistName, outcome: { artistMbid: item.artistMbid, state: 'uncertain', message: 'Retry to check membership' } });
            }
            items.splice(index, 1);
            return reply({ success: true, artistName: item.artistName, outcome: { artistMbid: item.artistMbid, state: 'added', message: 'Artist added to Lidarr' } });
          }
          items.splice(index, 1);
          return reply({ success: true, artistName: item.artistName });
        }
      }
      unhandled.push(`${method} ${path}${url.search}`);
      await reply({ error: `Unhandled catalog fixture: ${method} ${path}` }, 501);
    });
    // No real provider/analytics requests or service workers can bypass the mocks.
    await page.context().route(/https?:\/\//, async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.fallback();
      unhandled.push(`External request: ${url.origin}${url.pathname}`);
      await route.abort();
    });
    await use(page);
    expect(unhandled, 'Every API/provider request needs an explicit catalog fixture').toEqual([]);
  },
});
export { expect };
