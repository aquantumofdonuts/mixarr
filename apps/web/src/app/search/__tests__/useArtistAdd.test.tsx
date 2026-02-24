import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Hoist mock so it's available inside vi.mock factory
const { mockAddToast } = vi.hoisted(() => ({
  mockAddToast: vi.fn(),
}));

// Mock api module
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock toast module
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast: mockAddToast, toasts: [], removeToast: vi.fn() }),
}));

import { api } from '@/lib/api';
import { useArtistAdd, isAlreadyExistsError } from '../hooks/useArtistAdd';
import type { ArtistResult } from '../hooks/useSearch';

describe('useArtistAdd', () => {
  let mockSetResults: Mock<(updater: (prev: any[]) => any[]) => void>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockSetResults = vi.fn();
  });

  // ─── isAlreadyExistsError ─────────────────────────────────────────

  describe('isAlreadyExistsError', () => {
    it('returns true for ArtistExistsValidator message', () => {
      expect(isAlreadyExistsError('ArtistExistsValidator: artist exists')).toBe(true);
    });

    it('returns true for "already been added" message', () => {
      expect(isAlreadyExistsError('This artist has already been added to Lidarr')).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isAlreadyExistsError('Network timeout')).toBe(false);
    });
  });

  // ─── handleAddArtist — with MBID ─────────────────────────────────

  describe('handleAddArtist (with MBID)', () => {
    const artistWithMbid: ArtistResult = {
      foreignArtistId: 'mbid-123',
      artistName: 'Radiohead',
    };

    it('calls POST /api/search/artists/add with foreignArtistId', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, artist: { foreignArtistId: 'mbid-123' } },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist(artistWithMbid);
      });

      expect(api.post).toHaveBeenCalledWith('/api/search/artists/add', {
        foreignArtistId: 'mbid-123',
      });
    });

    it('shows success toast and updates results on success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, artist: { foreignArtistId: 'mbid-123' } },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist(artistWithMbid);
      });

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', title: 'Artist added' }),
      );
      expect(mockSetResults).toHaveBeenCalledWith(expect.any(Function));

      // Verify the updater function marks the artist as inLibrary
      const updater = mockSetResults.mock.calls[0][0];
      const updated = updater([
        { foreignArtistId: 'mbid-123', artistName: 'Radiohead', inLibrary: false },
        { foreignArtistId: 'other', artistName: 'Other', inLibrary: false },
      ]);
      expect(updated[0].inLibrary).toBe(true);
      expect(updated[1].inLibrary).toBe(false);
    });

    it('shows "Already in Library" toast for exists errors', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'ArtistExistsValidator: artist already exists',
        status: 409,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist(artistWithMbid);
      });

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info', title: 'Already in Library' }),
      );
    });

    it('shows error toast for generic errors', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Server error',
        status: 500,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist(artistWithMbid);
      });

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', title: 'Failed to add artist', message: 'Server error' }),
      );
    });

    it('sets and clears addingArtistId during the add', async () => {
      let resolvePost!: (value: any) => void;
      vi.mocked(api.post).mockImplementationOnce(
        () => new Promise((resolve) => { resolvePost = resolve; }),
      );

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      let addPromise: Promise<void>;
      act(() => {
        addPromise = result.current.handleAddArtist(artistWithMbid);
      });

      // While in-flight, addingArtistId should be the foreignArtistId
      expect(result.current.addingArtistId).toBe('mbid-123');

      await act(async () => {
        resolvePost({ data: { success: true }, error: null, status: 200 });
        await addPromise;
      });

      expect(result.current.addingArtistId).toBeNull();
    });
  });

  // ─── handleAddArtist — without MBID (discovery) ──────────────────

  describe('handleAddArtist (without MBID / discovery)', () => {
    const artistWithoutMbid: ArtistResult = {
      foreignArtistId: '',
      artistName: 'New Artist',
    };

    it('calls POST /api/search/discover/add with artistName', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, artist: { foreignArtistId: 'new-mbid' } },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist(artistWithoutMbid);
      });

      expect(api.post).toHaveBeenCalledWith('/api/search/discover/add', {
        artistName: 'New Artist',
      });
    });

    it('sets addingArtistId to the artistName for discovery add', async () => {
      let resolvePost!: (value: any) => void;
      vi.mocked(api.post).mockImplementationOnce(
        () => new Promise((resolve) => { resolvePost = resolve; }),
      );

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      let addPromise: Promise<void>;
      act(() => {
        addPromise = result.current.handleAddArtist(artistWithoutMbid);
      });

      expect(result.current.addingArtistId).toBe('New Artist');

      await act(async () => {
        resolvePost({ data: { success: true, artist: {} }, error: null, status: 200 });
        await addPromise;
      });

      expect(result.current.addingArtistId).toBeNull();
    });

    it('shows error toast and clears addingArtistId on discovery add error', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Discovery service unavailable',
        status: 503,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist(artistWithoutMbid);
      });

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          title: 'Failed to add artist',
          message: 'Discovery service unavailable',
        }),
      );
      expect(result.current.addingArtistId).toBeNull();
    });

    it('shows MBID candidates when API returns disambiguation data', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: {
          candidates: [
            { id: 'mbid-a', name: 'New Artist', disambiguation: 'UK band' },
            { id: 'mbid-b', name: 'New Artist', disambiguation: 'US rapper' },
          ],
        },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist(artistWithoutMbid);
      });

      expect(result.current.mbidCandidates).toHaveLength(2);
      expect(result.current.selectingArtist?.artistName).toBe('New Artist');
      // Results should NOT be updated yet
      expect(mockSetResults).not.toHaveBeenCalled();
    });
  });

  // ─── handleAddWithMbid ────────────────────────────────────────────

  describe('handleAddWithMbid', () => {
    it('does nothing when no selectingArtist is set', async () => {
      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddWithMbid('some-mbid');
      });

      expect(api.post).not.toHaveBeenCalled();
    });

    it('calls discovery add endpoint with artistName and selected mbid', async () => {
      // Step 1: trigger disambiguation
      vi.mocked(api.post).mockResolvedValueOnce({
        data: {
          candidates: [
            { id: 'mbid-a', name: 'Ambiguous', disambiguation: 'option A' },
          ],
        },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist({
          foreignArtistId: '',
          artistName: 'Ambiguous',
        });
      });

      expect(result.current.selectingArtist?.artistName).toBe('Ambiguous');

      // Step 2: select MBID
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, artist: { foreignArtistId: 'mbid-a' } },
        error: null,
        status: 200,
      });

      await act(async () => {
        await result.current.handleAddWithMbid('mbid-a');
      });

      expect(api.post).toHaveBeenLastCalledWith('/api/search/discover/add', {
        artistName: 'Ambiguous',
        mbid: 'mbid-a',
      });

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', title: 'Artist added' }),
      );
      expect(result.current.selectingArtist).toBeNull();
      expect(result.current.mbidCandidates).toBeNull();
      expect(result.current.addingArtistId).toBeNull();
    });

    it('shows error toast when MBID add fails', async () => {
      // Step 1: trigger disambiguation
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { candidates: [{ id: 'mbid-x', name: 'X' }] },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist({ foreignArtistId: '', artistName: 'X' });
      });

      // Step 2: MBID add fails
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Internal server error',
        status: 500,
      });

      await act(async () => {
        await result.current.handleAddWithMbid('mbid-x');
      });

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', title: 'Failed to add artist' }),
      );
    });
  });

  // ─── handleBatchAdd ───────────────────────────────────────────────

  describe('handleBatchAdd', () => {
    it('does nothing when ids set is empty', async () => {
      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleBatchAdd(new Set());
      });

      expect(api.post).not.toHaveBeenCalled();
    });

    it('calls POST /api/search/batch with artist IDs', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { added: ['id-1', 'id-2'], skipped: [], failed: [] },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleBatchAdd(new Set(['id-1', 'id-2']));
      });

      expect(api.post).toHaveBeenCalledWith('/api/search/batch', {
        artistIds: expect.arrayContaining(['id-1', 'id-2']),
      });
    });

    it('shows success toast with counts', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { added: ['id-1'], skipped: ['id-2'], failed: [{ id: 'id-3', error: 'err' }] },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleBatchAdd(new Set(['id-1', 'id-2', 'id-3']));
      });

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          title: 'Bulk add complete',
          message: 'Added: 1, Skipped: 1, Failed: 1',
        }),
      );
    });

    it('marks added and skipped artists as inLibrary', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { added: ['id-1'], skipped: ['id-2'], failed: [] },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleBatchAdd(new Set(['id-1', 'id-2']));
      });

      expect(mockSetResults).toHaveBeenCalledWith(expect.any(Function));
      const updater = mockSetResults.mock.calls[0][0];
      const updated = updater([
        { foreignArtistId: 'id-1', inLibrary: false },
        { foreignArtistId: 'id-2', inLibrary: false },
        { foreignArtistId: 'id-3', inLibrary: false },
      ]);
      expect(updated[0].inLibrary).toBe(true);
      expect(updated[1].inLibrary).toBe(true);
      expect(updated[2].inLibrary).toBe(false);
    });

    it('shows error toast when batch add fails', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Batch failed',
        status: 500,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleBatchAdd(new Set(['id-1']));
      });

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', title: 'Bulk add failed', message: 'Batch failed' }),
      );
    });

    it('sets and clears isBulkAdding', async () => {
      let resolvePost!: (value: any) => void;
      vi.mocked(api.post).mockImplementationOnce(
        () => new Promise((resolve) => { resolvePost = resolve; }),
      );

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      let batchPromise: Promise<any>;
      act(() => {
        batchPromise = result.current.handleBatchAdd(new Set(['id-1']));
      });

      expect(result.current.isBulkAdding).toBe(true);

      await act(async () => {
        resolvePost({ data: { added: ['id-1'], skipped: [], failed: [] }, error: null, status: 200 });
        await batchPromise;
      });

      expect(result.current.isBulkAdding).toBe(false);
    });
  });

  // ─── clearMbidModal ───────────────────────────────────────────────

  describe('clearMbidModal', () => {
    it('clears mbidCandidates and selectingArtist', async () => {
      // Trigger disambiguation to populate modal state
      vi.mocked(api.post).mockResolvedValueOnce({
        data: {
          candidates: [{ id: 'mbid-1', name: 'Artist' }],
        },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useArtistAdd(mockSetResults));

      await act(async () => {
        await result.current.handleAddArtist({ foreignArtistId: '', artistName: 'Artist' });
      });

      expect(result.current.mbidCandidates).not.toBeNull();
      expect(result.current.selectingArtist).not.toBeNull();

      act(() => {
        result.current.clearMbidModal();
      });

      expect(result.current.mbidCandidates).toBeNull();
      expect(result.current.selectingArtist).toBeNull();
    });
  });
});
