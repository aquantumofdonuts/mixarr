/**
 * Breadth-first collaboration-graph crawl bounded by a materialized-edge
 * budget. Visit nearer tiers first and stop when maxEdges is spent.
 *
 * maxDepth, clamped to MAX_DEPTH_CAP, also bounds expansions that report zero
 * new edges. Expansion and fullness checks are injected; the crawler opens no
 * database or network handles and uses reported edgesCreated counts as given.
 */

export interface OrbitDeps {
  /**
   * Expand one person: materialize their collaborators. Returns the neighbor
   * person ids discovered and how many NEW edges were materialized by this
   * expansion (the quantity the edge budget is measured in).
   */
  expand(personId: number): Promise<{ neighborIds: number[]; edgesCreated: number }>;
  /** Idempotency check: has this person already been fully expanded? */
  isFull(personId: number): Promise<boolean>;
}

export interface CrawlOptions {
  /**
   * Hard bound. The crawl stops as soon as the running total of materialized
   * edges reaches this value. The check happens AFTER each expansion, so the
   * total may overshoot by up to one expansion's `edgesCreated` — that is fine
   * and intended; the guarantee is TERMINATION, not an exact cap.
   */
  maxEdges: number;
  /**
   * Soft secondary guard: neighbors discovered at a depth beyond this are not
   * enqueued. Defaults to 3. The PRIMARY bound is always `maxEdges`.
   */
  maxDepth?: number;
}

export interface CrawlResult {
  personsExpanded: number;
  edgesMaterialized: number;
}

interface QueueEntry {
  personId: number;
  depth: number;
}

const DEFAULT_MAX_DEPTH = 3;

/**
 * Absolute ceiling on the effective maxDepth, regardless of what a caller
 * requests. This is the termination backstop for the pathological case where
 * every expansion reports `edgesCreated: 0` on an ever-fresh infinite graph:
 * the edge budget never advances, so depth becomes the only thing that can stop
 * the crawl. Clamping guarantees termination even for `maxDepth: Infinity`.
 */
const MAX_DEPTH_CAP = 8;

export class OrbitCrawler {
  constructor(private deps: OrbitDeps) {}

  /**
   * Breadth-first crawl outward from `seeds`, bounded by an edge budget.
   *
   * Semantics of the idempotency skip: if `isFull(personId)` is true we skip the
   * person ENTIRELY — we neither expand it nor recurse through it in THIS crawl.
   * A fresh `expand` is the only source of a person's neighbors, and a full
   * person is not re-expanded, so its neighbors are unknown to this crawl and
   * cannot be traversed. Consequence (by design): re-crawling a fully-settled
   * orbit performs ZERO `expand` calls and returns `edgesMaterialized: 0`.
   */
  async crawl(seeds: number[], opts: CrawlOptions): Promise<CrawlResult> {
    const maxDepth = Math.min(opts.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_DEPTH_CAP);
    const { maxEdges } = opts;

    // `visited` guards against expanding (or re-enqueuing) the same person twice
    // within a crawl, even when reached via multiple paths or listed twice as a
    // seed. A person is added to `visited` when it is enqueued, never later.
    const visited = new Set<number>();
    const queue: QueueEntry[] = [];

    for (const seed of seeds) {
      if (!visited.has(seed)) {
        visited.add(seed);
        queue.push({ personId: seed, depth: 0 });
      }
    }

    let personsExpanded = 0;
    let edgesMaterialized = 0;

    // FIFO queue -> tier N fully drains before tier N+1, i.e. breadth-first.
    let head = 0;
    while (head < queue.length) {
      // Hard bound: budget spent -> stop dequeuing. Checked before pulling the
      // next person so no further expansion happens once the budget is reached.
      if (edgesMaterialized >= maxEdges) break;

      const { personId, depth } = queue[head++];

      // Idempotency: already-full persons are skipped entirely (see doc above).
      if (await this.deps.isFull(personId)) continue;

      const { neighborIds, edgesCreated } = await this.deps.expand(personId);
      personsExpanded += 1;
      edgesMaterialized += edgesCreated;

      // Soft depth guard: only enqueue the next tier if it is within maxDepth.
      if (depth < maxDepth) {
        for (const neighborId of neighborIds) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push({ personId: neighborId, depth: depth + 1 });
          }
        }
      }
    }

    return { personsExpanded, edgesMaterialized };
  }
}
