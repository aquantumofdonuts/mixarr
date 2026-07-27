/**
 * Shared frontend types for the Collaboration Constellation feature.
 *
 * These mirror the API contract exposed by `apps/api/src/routes/constellation.ts`
 * (which in turn re-exports the `GraphService` shapes). They are duplicated here
 * rather than pulled from `@mixarr/shared-types` because the constellation types
 * currently live in the API service layer, not the shared package; keeping a thin
 * frontend copy avoids reaching across the app boundary for server-only code.
 */

/** A person node in the constellation graph. */
export interface GraphNode {
  personId: number;
  displayName: string;
  genre: string | null;
  /** Visual size channel = max(popularity, credit prominence). */
  size: number;
  owned: boolean;
}

/** A collaboration edge between two person nodes. */
export interface GraphEdge {
  source: number;
  target: number;
  weight: number;
  bridge: number | null;
  bridgeConfident: boolean;
  roleBitmask: number;
}

/** A focus-centred slice of the graph (focus + ring-1 + ring-2). */
export interface Subgraph {
  focusId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Opaque, user-scoped SSE stream handle. `generation` is bumped on every
 * re-center; SSE events carrying an older generation are stale and dropped.
 */
export interface StreamToken {
  id: string;
  generation: number;
}

/** Result of a six-degrees path query. */
export interface PathResult {
  nodes: number[];
  degrees: number;
  mode: 'shortest' | 'interesting';
  totalBridge?: number;
}

// ---------------------------------------------------------------------------
// Response envelopes (as returned by the constellation routes)
// ---------------------------------------------------------------------------

/** `GET /api/constellation/seed` response. */
export interface SeedResponse {
  focusId: number;
  subgraph: Subgraph;
  streamToken: StreamToken;
}

/** `GET /api/constellation/expand/:personId` response. */
export interface ExpandResponse {
  personId: number;
  enqueued: boolean;
  subgraph: Subgraph;
}

/** `GET /api/constellation/owned` response. */
export interface OwnedResponse {
  owned: number[];
}

/** A single release in a person's discography (side-panel row). */
export interface ReleaseItem {
  releaseId: number;
  title: string;
  year: number | null;
  master: number | null;
}

/** `GET /api/constellation/person/:personId/releases` response. */
export interface ReleasesResponse {
  personId: number;
  releases: ReleaseItem[];
}

/** `POST /api/constellation/person/:personId/subscribe` success response. */
export interface SubscribeResponse {
  added: boolean;
  mbid: string;
  target: 'artist' | 'album';
}

/**
 * A single background-expand SSE payload. Carries the `generation` it was
 * published with plus the newly-expanded node/edge data. The exact node/edge
 * fields depend on the expand worker (Task 16); the generation field is the
 * contract the client relies on for the re-center race guard.
 */
export interface StreamPayload {
  generation: number;
  [key: string]: unknown;
}
