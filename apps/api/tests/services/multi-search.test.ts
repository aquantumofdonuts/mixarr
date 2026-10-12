import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connection: vi.fn(), spotify: vi.fn(), deezer: vi.fn(), tidal: vi.fn(), bandcamp: vi.fn() }));
vi.mock('../../src/lib/db.js', () => ({ default: { connection: { findFirst: mocks.connection } } }));
vi.mock('../../src/lib/logger.js', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
vi.mock('../../src/services/spotify.js', () => ({ SpotifyService: class { searchArtists = mocks.spotify; } }));
vi.mock('../../src/services/deezer.js', () => ({ searchDeezerArtists: mocks.deezer }));
vi.mock('../../src/services/tidal.js', () => ({ TidalService: class { searchArtists = mocks.tidal; } }));
vi.mock('../../src/services/bandcamp.js', () => ({ BandcampService: class { searchArtists = mocks.bandcamp; } }));
import { multiSourceSearch, type SearchSource } from '../../src/services/multi-search.js';
beforeEach(() => {
  vi.resetAllMocks(); mocks.connection.mockResolvedValue({ config: {} });
  mocks.spotify.mockResolvedValue([]); mocks.deezer.mockResolvedValue([]); mocks.tidal.mockResolvedValue([]); mocks.bandcamp.mockResolvedValue({ artists: [] });
});
describe('multi-source search diagnostics', () => {
  it('retains successful Deezer rows and reports a failed Spotify source without leaking its error', async () => {
    mocks.spotify.mockRejectedValue(new Error('https://secret@provider.invalid?token=private'));
    mocks.deezer.mockResolvedValue([{ id: 7, name: 'Artist', picture_medium: '/artist.jpg' }]);
    const errors: { source: SearchSource; message: string }[] = [];
    const rows = await multiSourceSearch('Artist', 7, ['spotify', 'deezer'], 25, errors);
    expect(rows).toMatchObject([{ name: 'Artist', deezerId: 7, sources: ['deezer'] }]);
    expect(errors).toEqual([{ source: 'spotify', message: 'Spotify search unavailable. Check the connection and retry.' }]);
  });
  it('reports all enabled source failures instead of presenting them as a successful empty search', async () => {
    mocks.connection.mockResolvedValue(null);
    mocks.deezer.mockRejectedValue(new Error('offline')); mocks.bandcamp.mockRejectedValue(new Error('offline'));
    const errors: { source: SearchSource; message: string }[] = [];
    expect(await multiSourceSearch('Artist', 7, ['spotify', 'deezer', 'tidal', 'bandcamp'], 25, errors)).toEqual([]);
    expect(errors.map(error => error.source)).toEqual(['spotify', 'deezer', 'tidal', 'bandcamp']);
  });
  it('keeps a completed no-match response distinct from failed providers and preserves the array consumer', async () => {
    const errors: { source: SearchSource; message: string }[] = [];
    expect(await multiSourceSearch('Unknown', 7, ['deezer'], 25, errors)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
