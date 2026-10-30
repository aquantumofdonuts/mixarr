export type AcquisitionState = 'available' | 'adding' | 'added' | 'already-in-library' | 'failed' | 'uncertain' | 'identity-required' | 'connection-required';
export interface AcquisitionOutcome {
  artistMbid: string;
  state: 'added' | 'already-in-library' | 'failed' | 'uncertain';
  message: string;
}
export interface ArtistSourceRecord {
  key: string;
  kind: 'subscription-result' | 'review-item';
  label: string;
  subscriptionId: number | null;
  runId: number | null;
  recordedAt: string;
  recordStatus: string;
  sourceUrl: string | null;
}
export interface ArtistDetail {
  mbid: string;
  name: string;
  imageUrl: string | null;
  disambiguation: string | null;
  membership: 'in-library' | 'not-in-library' | 'unknown';
  sources: ArtistSourceRecord[];
  sourcesNextCursor: string | null;
  unavailable: Array<'metadata' | 'membership' | 'sources'>;
}
export interface UndoDecisionResponse { undoToken: string; undoExpiresAt: string; }
export interface LabelArtistPage {
  artists: Array<{ id: string; name: string; sortName: string; imageUrl: string | null }>;
  releasesProcessed: number;
  totalReleases: number;
  nextReleaseOffset: number | null;
}
