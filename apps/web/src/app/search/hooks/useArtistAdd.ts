'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { ArtistResult, MbidCandidate } from './useSearch';

export type { ArtistResult, MbidCandidate };

interface BatchAddResult {
  added: string[];
  skipped: string[];
  failed: { id: string; error: string }[];
}

/**
 * Returns `true` when the API error string indicates the artist already
 * exists in the user's Lidarr library.
 */
export function isAlreadyExistsError(error: string): boolean {
  return error.includes('ArtistExistsValidator') || error.includes('already been added');
}

/**
 * Hook that owns all artist-add logic: single add (with or without MBID),
 * MBID disambiguation modal state, and batch add.
 *
 * @param setResults – state setter from `useSearch` so the hook can mark
 *                     artists as `inLibrary` after a successful add.
 */
export function useArtistAdd(
  setResults: (updater: (prev: any[]) => any[]) => void,
) {
  const { addToast } = useToast();
  const [addingArtistId, setAddingArtistId] = useState<string | null>(null);
  const [mbidCandidates, setMbidCandidates] = useState<MbidCandidate[] | null>(null);
  const [selectingArtist, setSelectingArtist] = useState<ArtistResult | null>(null);
  const [isBulkAdding, setIsBulkAdding] = useState(false);

  /** Show a friendly toast depending on whether the error is "already exists". */
  const handleAddArtistError = useCallback(
    (error: string, artistName: string) => {
      if (isAlreadyExistsError(error)) {
        addToast({
          type: 'info',
          title: 'Already in Library',
          message: `"${artistName}" is already in your Lidarr library`,
        });
      } else {
        addToast({ type: 'error', title: 'Failed to add artist', message: error });
      }
    },
    [addToast],
  );

  /**
   * Add a single artist.
   *
   * - Artists **without** a foreignArtistId go through the discovery add
   *   endpoint, which may return MBID candidates for disambiguation.
   * - Artists **with** a foreignArtistId are added directly via MBID.
   */
  const handleAddArtist = useCallback(
    async (artist: ArtistResult) => {
      // --- No MBID: discovery add ---
      if (!artist.foreignArtistId) {
        setAddingArtistId(artist.artistName);
        try {
          const { data, error } = await api.post<{
            success?: boolean;
            artist?: any;
            error?: string;
            candidates?: MbidCandidate[];
            artistName?: string;
          }>('/api/search/discover/add', {
            artistName: artist.artistName,
          });

          if (error) {
            handleAddArtistError(error, artist.artistName);
          } else if (data?.candidates) {
            // Multiple MBID matches – show disambiguation modal
            setMbidCandidates(data.candidates);
            setSelectingArtist(artist);
          } else if (data?.success) {
            addToast({
              type: 'success',
              title: 'Artist added',
              message: `${artist.artistName} added to Lidarr`,
            });
            setResults((prev) =>
              prev.map((r) =>
                r.artistName === artist.artistName
                  ? { ...r, inLibrary: true, foreignArtistId: data.artist?.foreignArtistId }
                  : r,
              ),
            );
          }
        } finally {
          setAddingArtistId(null);
        }
        return;
      }

      // --- Has MBID: direct add ---
      setAddingArtistId(artist.foreignArtistId);
      try {
        const { data, error } = await api.post<{ success: boolean; artist?: any }>(
          '/api/search/artists/add',
          { foreignArtistId: artist.foreignArtistId },
        );

        if (error) {
          handleAddArtistError(error, artist.artistName);
        } else if (data?.success) {
          addToast({
            type: 'success',
            title: 'Artist added',
            message: `${artist.artistName} added to Lidarr`,
          });
          setResults((prev) =>
            prev.map((r) =>
              r.foreignArtistId === artist.foreignArtistId ? { ...r, inLibrary: true } : r,
            ),
          );
        }
      } finally {
        setAddingArtistId(null);
      }
    },
    [addToast, handleAddArtistError, setResults],
  );

  /**
   * Complete the MBID disambiguation flow by selecting a specific MBID
   * for the artist currently in `selectingArtist`.
   */
  const handleAddWithMbid = useCallback(
    async (mbid: string) => {
      if (!selectingArtist) return;

      setAddingArtistId(selectingArtist.artistName);
      setMbidCandidates(null);
      try {
        const { data, error } = await api.post<{ success: boolean; artist?: any }>(
          '/api/search/discover/add',
          { artistName: selectingArtist.artistName, mbid },
        );

        if (error) {
          handleAddArtistError(error, selectingArtist.artistName);
        } else if (data?.success) {
          addToast({
            type: 'success',
            title: 'Artist added',
            message: `${selectingArtist.artistName} added to Lidarr`,
          });
          setResults((prev) =>
            prev.map((r) =>
              r.artistName === selectingArtist.artistName
                ? { ...r, inLibrary: true, foreignArtistId: mbid }
                : r,
            ),
          );
        }
      } finally {
        setSelectingArtist(null);
        setAddingArtistId(null);
      }
    },
    [selectingArtist, addToast, handleAddArtistError, setResults],
  );

  /**
   * Batch-add multiple artists by their foreignArtistId set.
   * Returns the API result so the caller can clear its selection state.
   */
  const handleBatchAdd = useCallback(
    async (ids: Set<string>) => {
      if (ids.size === 0) return null;

      setIsBulkAdding(true);
      try {
        const { data, error } = await api.post<BatchAddResult>('/api/search/batch', {
          artistIds: Array.from(ids),
        });

        if (error) {
          addToast({ type: 'error', title: 'Bulk add failed', message: error });
        } else if (data) {
          addToast({
            type: 'success',
            title: 'Bulk add complete',
            message: `Added: ${data.added.length}, Skipped: ${data.skipped.length}, Failed: ${data.failed.length}`,
          });
          const addedSet = new Set([...data.added, ...data.skipped]);
          setResults((prev) =>
            prev.map((r) => (addedSet.has(r.foreignArtistId) ? { ...r, inLibrary: true } : r)),
          );
        }

        return data ?? null;
      } finally {
        setIsBulkAdding(false);
      }
    },
    [addToast, setResults],
  );

  /** Close the MBID disambiguation modal and clear related state. */
  const clearMbidModal = useCallback(() => {
    setMbidCandidates(null);
    setSelectingArtist(null);
  }, []);

  return {
    // State
    addingArtistId,
    mbidCandidates,
    selectingArtist,
    isBulkAdding,

    // Actions
    handleAddArtist,
    handleAddWithMbid,
    handleBatchAdd,
    clearMbidModal,
  };
}
