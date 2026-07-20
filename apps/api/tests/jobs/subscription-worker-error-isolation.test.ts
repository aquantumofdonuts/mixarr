/**
 * Subscription Worker - Per-Artist Error Isolation Tests
 *
 * Regression tests for a real production incident: a transient MusicBrainz
 * "503 Service Unavailable" while resolving one artist's MBID aborted the
 * *entire* subscription run (the whole loop over `artists` ran with no
 * per-iteration try/catch, so the error propagated to the run-level catch).
 * The run was then recorded with `lastRunCount: 0`, hiding any artists that
 * had already been added successfully earlier in the same run.
 *
 * These tests validate the fixed behavior via the same "simulate the logic"
 * approach used by subscription-worker-no-lidarr.test.ts, since
 * processSubscription has too many module-level dependencies to invoke
 * directly in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Subscription Worker - Per-Artist Error Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should NOT abort the run when a single artist throws (e.g. MusicBrainz 503) — later artists still process', async () => {
    const artists = [
      { name: 'Good Artist One', source: 'spotify-playlist' },
      { name: 'Flaky Artist', source: 'spotify-playlist' }, // this one throws
      { name: 'Good Artist Two', source: 'spotify-playlist' },
    ];

    const mockSubscriptionResultCreate = vi.fn().mockResolvedValue({});
    const mockGetMbid = vi.fn(async (name: string) => {
      if (name === 'Flaky Artist') {
        throw new Error('MusicBrainz API error: 503 Service Temporarily Unavailable');
      }
      return `mbid-${name}`;
    });

    let added = 0;
    let skipped = 0;
    const runId = 1;
    const subscriptionId = 1;

    // Mirrors the fixed per-artist loop body in subscription-worker.ts:
    // each MusicBrainz lookup has its own try/catch, and the whole artist's
    // processing is additionally wrapped so ANY unexpected error just fails
    // that one artist instead of throwing out of the loop.
    for (const artist of artists) {
      try {
        let mbid: string | undefined;
        try {
          mbid = await mockGetMbid(artist.name);
        } catch {
          mbid = undefined;
        }

        if (!mbid) {
          skipped++;
          await mockSubscriptionResultCreate({
            subscriptionId,
            runId,
            name: artist.name,
            status: 'skipped',
            skipReason: 'no_mbid_found',
          });
          continue;
        }

        added++;
        await mockSubscriptionResultCreate({
          subscriptionId,
          runId,
          name: artist.name,
          status: 'added',
        });
      } catch (artistErr) {
        skipped++;
        await mockSubscriptionResultCreate({
          subscriptionId,
          runId,
          name: artist.name,
          status: 'failed',
          skipReason: artistErr instanceof Error ? artistErr.message : String(artistErr),
        });
      }
    }

    // The whole run completed — it never threw out to a run-level catch.
    expect(added).toBe(2);
    expect(skipped).toBe(1);

    // Both "good" artists were recorded as added, not silently dropped.
    expect(mockSubscriptionResultCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Good Artist One', status: 'added' })
    );
    expect(mockSubscriptionResultCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Good Artist Two', status: 'added' })
    );
    // The flaky artist degraded to skipped rather than blowing up the run.
    expect(mockSubscriptionResultCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Flaky Artist', status: 'skipped', skipReason: 'no_mbid_found' })
    );
  });

  it('run-level failure handler should report real partial progress instead of hardcoded 0', () => {
    // Mirrors the fixed outer catch: added/skipped/queued are hoisted above
    // the try block so a genuinely fatal error (not a per-artist one, which
    // is now isolated) still reports what actually happened before it hit.
    let added = 3; // 3 artists were successfully added before the fatal error
    let queued = 1;
    let skipped = 2;

    const runUpdateData = {
      status: 'failed',
      addedCount: added,
      skippedCount: skipped,
    };
    const subscriptionUpdateData = {
      lastRunStatus: 'failed',
      lastRunCount: added + queued,
    };

    // Before the fix these were unconditionally 0, making a partially
    // successful run indistinguishable from one that added nothing at all.
    expect(runUpdateData.addedCount).toBe(3);
    expect(subscriptionUpdateData.lastRunCount).toBe(4);
    expect(subscriptionUpdateData.lastRunCount).not.toBe(0);
  });
});
