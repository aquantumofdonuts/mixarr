import { test as base, expect, type Page, type Locator } from '@playwright/test';
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
  albumName: null as string | null, releaseYear: null, spotifyId: null, mbid: index % 3 ? ARTIST_IDS[index % 2] : null,
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
  catalogPage: async ({ page, catalogRole, catalogScenario, catalogAuthenticated }, runFixture) => {
    let authenticated = catalogAuthenticated;
    const user = { ...CATALOG_USER, role: catalogRole };
    const items = catalogScenario === 'empty' ? [] : [...catalogFeed];
    const queue = catalogScenario === 'empty' ? [] : catalogQueue.map(item => ({ ...item }));
    const added = new Set<string>();
    const dismissed = new Map<string, FeedItem>();
    const subscriptionResults = Array.from({ length: 53 }, (_, index) => ({
      id: 101 + index, itemType: 'artist', name: index === 0 ? 'Unknown Common Name' : `Result Artist ${index + 1}`,
      artistName: null, mbid: index === 0 ? null : ARTIST_IDS[index % 2], status: 'pending', skipReason: null,
      createdAt: recordedAt, runId: 71, imageUrl: null,
    }));
    const subscription = { id: 11, name: 'Weekly discoveries', type: 'lastfm_similar', config: { artist: 'Common Name' }, resultHandling: 'queue', resultLimit: 50, isActive: true, schedule: '0 0 * * 0', lastRun: recordedAt };
    const runs = [71, 72].map(id => ({ id, status: 'completed', resultsCount: id === 71 ? 53 : 0, addedCount: 0, skippedCount: 0, errorMessage: null, startedAt: recordedAt, completedAt: recordedAt }));
    let feedRecordsMarkedAdded = 0;
    const pendingDiscoveryRecords = () => items.filter(item => !['adding', 'failed', 'uncertain'].includes(item.acquisitionState || '')).reduce((count, item) => count + item.id.slice('feed-'.length).split('-').length, 0);
    const unhandled: string[] = [];
    await page.context().route(/\/api\//, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
      if (method === 'GET') {
        if (path === '/api/subscriptions/11') return reply({ subscription });
        if (path === '/api/subscriptions/11/runs') return reply({ runs });
        if (/^\/api\/subscriptions\/11\/runs\/(71|72)$/.test(path)) {
          const id = Number(path.split('/').at(-1));
          return reply({ run: runs.find(run => run.id === id), results: id === 71 ? subscriptionResults : [] });
        }
        if (path === '/api/subscriptions/11/results') {
          const status = url.searchParams.get('status');
          const matches = subscriptionResults.filter(result => !status || result.status === status);
          const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 50);
          const statusCounts = subscriptionResults.reduce((counts, result) => ({ ...counts, [result.status]: (counts[result.status] || 0) + 1 }), {} as Record<string, number>);
          return reply({ results: matches.slice(offset, offset + limit), total: matches.length, statusCounts, offset, limit });
        }
        if (path === '/api/search/musicbrainz/artist') return reply({ results: ARTIST_IDS.map((id, index) => ({ id, name: 'Unknown Common Name', disambiguation: index ? 'Canadian ensemble' : 'British solo artist', country: index ? 'CA' : 'GB' })) });
        const artistPath = path.match(/^\/api\/search\/artist\/([^/]+)\/(detail|releases)$/);
        if (artistPath) {
          const mbid = artistPath[1];
          const artist = catalogFeed.find(item => item.artistMbid === mbid);
          if (!artist) return reply({ error: 'Unknown fixture identity' }, 400);
          if (artistPath[2] === 'detail') return reply({
            mbid, name: artist.artistName, imageUrl: artist.imageUrl, disambiguation: 'Fixture identity',
            membership: added.has(mbid) ? 'in-library' : 'not-in-library',
            sources: [{ key: 'subscription-result:1', kind: 'subscription-result', label: 'Weekly discoveries', subscriptionId: 11, runId: 71, recordedAt, recordStatus: 'pending', sourceUrl: null }],
            sourcesNextCursor: null, unavailable: [],
          });
          const releases = Array.from({ length: 26 }, (_, index) => ({
            id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, title: `Catalog release ${index + 1}`,
            'first-release-date': String(1990 + index), 'primary-type': 'Album',
          }));
          const offset = Number(url.searchParams.get('offset') || 0);
          const limit = Number(url.searchParams.get('limit') || 100);
          return reply({ releaseGroups: releases.slice(offset, offset + limit), count: releases.length });
        }
        switch (path) {
          case '/api/auth/me': return reply({ user: authenticated ? user : null, setupRequired: false });
          case '/api/auth/setup-required': return reply({ setupRequired: false });
          case '/api/auth/sso/enabled': return reply({ providers: [] });
          case '/api/health/live': return reply({ status: 'ok', version: '2.3.5', update: null });
          case '/api/feed': {
            if (catalogScenario === 'error') return reply({ error: 'Catalog source unavailable' }, 503);
            const offset = Number(url.searchParams.get('offset') || 0);
            const limit = Number(url.searchParams.get('limit') || 50);
            return reply({ items: items.slice(offset, offset + limit).map(({ status: _status, ...item }) => item), total: items.length, stats: { pending: pendingDiscoveryRecords(), addedToday: feedRecordsMarkedAdded } });
          }
          case '/api/dashboard/stats': return reply({ stats: { activeSubscriptions: 1, pendingDiscoveryRecords: pendingDiscoveryRecords(), subscriptionRecordsMarkedAdded: feedRecordsMarkedAdded + subscriptionResults.filter(result => result.status === 'added').length, pendingReviews: queue.length, runningJobs: 0, activeConnections: 1 } });
          case '/api/discover/profiles': return reply({
            qualityProfiles: [{ id: 1, name: 'Lossless' }, { id: 2, name: 'Portable' }],
            metadataProfiles: [{ id: 1, name: 'Studio albums' }],
            rootFolders: [{ id: 1, path: '/music' }, { id: 2, path: '/archive' }],
            defaults: { qualityProfileId: 1, metadataProfileId: 1, rootFolderPath: '/music', monitorOption: 'all', monitorNewItems: 'all', searchOnAdd: true },
          });
          case '/api/search/ai/status': return reply({ available: false });
          case '/api/search/lidarr/artists': return reply({ artists: [], total: 0, needingRefresh: 0, issueStats: { noAlbums: 0, noPoster: 0, noOverview: 0, noGenres: 0 }, healthScore: 100 });
          case '/api/search/discover': return reply({ results: catalogScenario === 'empty' ? [] : catalogFeed.map((item, index) => ({ name: item.artistName, mbid: item.artistMbid, imageUrl: item.imageUrl, sources: item.sources, spotifyId: `fixture-${index}`, inLibrary: added.has(item.artistMbid || '') })) });
          case '/api/subscriptions': return reply({ subscriptions: catalogScenario === 'empty' ? [] : [{ ...subscription, userId: user.id, lastRunStatus: 'completed', lastRunCount: 3, nextRun: null }] });
          case '/api/subscriptions/presets/list': return reply({ presets: [] });
          case '/api/connections/has-lidarr': return reply({ hasLidarr: true });
          case '/api/connections': return reply({ connections: catalogScenario === 'empty' ? [] : [{ id: 1, userId: user.id, type: 'lidarr', name: 'Catalog Lidarr', isActive: true, lastTest: null, createdAt: recordedAt }] });
          case '/api/imports/review/queue': {
            const status = url.searchParams.get('status') || 'pending';
            const itemType = url.searchParams.get('itemType');
            const q = (url.searchParams.get('q') || '').trim();
            const limit = Number(url.searchParams.get('limit') || 50);
            const scope = { actor: user.id, admin: user.role === 'admin', status, itemType, q };
            if (!Number.isInteger(limit) || limit < 1 || limit > 100 || q.length > 120) return reply({ error: 'Invalid queue query' }, 400);
            const matches = queue.filter(item => (scope.admin || item.userId === user.id) && item.status === status && (!itemType || item.itemType === itemType) && (!q || item.artistName.toLowerCase().includes(q.toLowerCase()) || item.albumName?.toLowerCase().includes(q.toLowerCase())))
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
            let cursor: { id: number; createdAt: string } | null = null;
            if (url.searchParams.has('cursor')) {
              try {
                const value = JSON.parse(Buffer.from(url.searchParams.get('cursor')!, 'base64url').toString('utf8'));
                if (value.v !== 1 || !Number.isSafeInteger(value.id) || value.id <= 0 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || Object.entries(scope).some(([key, expected]) => value[key] !== expected)) throw new Error('Invalid cursor');
                cursor = value;
              } catch { return reply({ error: 'Invalid review cursor', code: 'INVALID_CURSOR' }, 400); }
            }
            const rows = matches.filter(item => !cursor || item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.id < cursor.id));
            const items = rows.slice(0, limit);
            const last = items.at(-1);
            const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ v: 1, id: last.id, createdAt: last.createdAt, ...scope })).toString('base64url') : null;
            return reply({ items, total: matches.length, nextCursor });
          }
          case '/api/slskd/downloads': return reply(catalogScenario === 'empty' ? [] : [{ id: 1, connectionId: 1, username: 'fixture-peer', artistName: 'Common Name', filename: 'record.flac', fileSize: 1024, status: 'failed', error: 'Fixture transfer interrupted', createdAt: recordedAt, updatedAt: recordedAt }]);
          case '/api/settings/constellation': return reply({ settings: { constellationIndexEnabled: false, constellationIndexPath: '/data/constellation/index.db', orbitEdgeBudget: 250000, dailyApiBudget: 5000, fanoutN: 8, pathMaxDegrees: 6, indexRefresh: 'monthly' } });
          case '/api/settings/constellation/usage': return reply({ day: '2026-10-09', used: 17, limit: 5000 });
          case '/api/settings':
          case '/api/settings/global': return reply({ settings: {} });
          case '/api/ai/settings': return reply({ settings: { openaiEnabled: false, openaiConfigured: false, anthropicEnabled: false, anthropicConfigured: false } });
          case '/api/sso/providers': return reply({ providers: [] });
          case '/api/settings/base-url': return reply({ baseUrl: 'http://localhost' });
        }
      }
      if (method === 'PUT' && path === '/api/subscriptions/11') {
        subscription.isActive = request.postDataJSON().isActive;
        return reply({ subscription });
      }
      if (method === 'PUT' && /^\/api\/imports\/review\/\d+$/.test(path) && request.postDataJSON().status === 'rejected') {
        const item = queue.find(item => item.id === Number(path.split('/').at(-1)));
        if (!item) return reply({ error: 'Review item not found' }, 404);
        item.status = 'rejected';
        return reply({ success: true, undoToken: `signed-review-${item.id}`, undoExpiresAt: new Date(Date.now() + 120_000).toISOString() });
      }
      if (method === 'POST') {
        const decision = path.match(/^\/api\/subscriptions\/11\/results\/(\d+)\/(approve|reject)$/);
        if (decision) {
          const result = subscriptionResults.find(result => result.id === Number(decision[1]));
          if (!result) return reply({ error: 'Result not found' }, 404);
          if (decision[2] === 'reject') { result.status = 'rejected'; return reply({ success: true }); }
          const mbid = result.mbid || request.postDataJSON()?.mbid;
          if (!ARTIST_IDS.includes(mbid)) return reply({ error: 'Choose an identity', code: 'IDENTITY_REQUIRED' }, 422);
          result.mbid = mbid; result.status = 'added'; added.add(mbid);
          return reply({ success: true, outcome: 'added', message: 'Artist added to Lidarr' });
        }
        if (path === '/api/jobs/run/subscription/11') return reply({ success: true });
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
        if (path === '/api/feed/restore') {
          const token = request.postDataJSON().undoToken;
          const item = dismissed.get(token);
          if (!item) return reply({ error: 'Decision can no longer be restored' }, 409);
          dismissed.delete(token);
          items.push(item);
          return reply({ restoredIds: item.id.replace('feed-', '').split('-').map(Number) });
        }
        if (/^\/api\/feed\/[^/]+\/(approve|dismiss)$/.test(path)) {
          const id = decodeURIComponent(path.split('/')[3]);
          const index = items.findIndex(item => item.id === id);
          if (index < 0) return reply({ error: 'Not found' }, 404);
          const item = items[index];
          if (path.endsWith('/approve')) {
            const chosen = request.postDataJSON()?.mbid;
            if (item.artistMbid && chosen && chosen !== item.artistMbid) return reply({ error: 'Source identity changed', code: 'IDENTITY_CONFLICT' }, 409);
            const mbid = item.artistMbid || chosen;
            if (!ARTIST_IDS.includes(mbid)) return reply({ error: 'Choose an artist identity', code: 'IDENTITY_REQUIRED' }, 422);
            if (catalogScenario === 'add-failed') {
              items[index] = { ...item, acquisitionState: 'uncertain', acquisitionMessage: 'Retry to check membership' };
              return reply({ success: false, artistName: item.artistName, outcome: { artistMbid: mbid, state: 'uncertain', message: 'Retry to check membership' } });
            }
            added.add(mbid);
            feedRecordsMarkedAdded += item.id.slice('feed-'.length).split('-').length;
            items.splice(index, 1);
            return reply({ success: true, artistName: item.artistName, outcome: { artistMbid: mbid, state: 'added', message: 'Artist added to Lidarr' } });
          }
          items.splice(index, 1);
          const undoToken = `catalog-undo-${item.id}`;
          dismissed.set(undoToken, item);
          return reply({ success: true, artistName: item.artistName, undoToken, undoExpiresAt: new Date(Date.now() + 120_000).toISOString() });
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
    await runFixture(page);
    expect(unhandled, 'Every API/provider request needs an explicit catalog fixture').toEqual([]);
  },
});
export { expect };

/** Focus by keyboard before activation, including a painted focus indicator. */
export async function keyboardActivate(page: Page, control: Locator, key = 'Enter') {
  await expect(control).toBeEnabled();
  // Establish keyboard modality before focusing the specific control.
  await page.keyboard.press('Tab');
  await control.focus();
  await expect(control).toBeFocused();
  expect(await control.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(':focus-visible') && (
      (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none'
    );
  }), 'Keyboard focus must have a painted outline or ring').toBe(true);
  await page.keyboard.press(key);
}

/** Check the actual scrolling main as well as the shell, which clips overflow. */
export async function expectCatalogFits(page: Page) {
  const dimensions = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, main: main.clientWidth, content: main.scrollWidth };
  });
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.content, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.main + 1);
}
