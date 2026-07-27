/**
 * OrbitCrawler — breadth-first, edge-budget-bounded crawl of a collaboration graph.
 *
 * WHY A BUDGET, NOT A DEPTH: collaboration graphs are small-world. A fixed BFS
 * depth from realistic seeds reaches essentially all of Discogs, so depth alone
 * is not a usable bound — a few tiers "explode" to the whole universe. The hard
 * bound here is a materialized-EDGE budget (`maxEdges`): we fill nearer tiers
 * first (breadth-first) and stop the moment the budget is spent, no matter how
 * connected the graph is. `maxDepth` is only a soft secondary guard.
 *
 * PURE ALGORITHM OVER INJECTED SEAMS: this class references no Prisma, no
 * network, and no concrete service — mirroring the `CreditSource` seam
 * philosophy of ExpansionService. It operates entirely through two async
 * function seams (`expand`, `isFull`), so it is trivially unit-testable with
 * fakes. Do NOT import a data backend here.
 *
 * INTENDED PRODUCTION WIRING (Task 10's worker builds the adapter):
 *   const crawler = new OrbitCrawler({
 *     async expand(personId) {
 *       await expansionService.expandPerson(personId); // materializes edges + persons
 *       const edges = await prisma.constellationEdge.findMany({
 *         where: { sourcePersonId: personId },
 *         select: { targetPersonId: true },
 *       });
 *       return {
 *         neighborIds: edges.map((e) => e.targetPersonId),
 *         edgesCreated: edges.length,        // NEW edges from this expansion
 *       };
 *     },
 *     async isFull(personId) {
 *       return (await prisma.constellationPerson.findUnique({
 *         where: { personId },
 *       }))?.fullyExpanded ?? false;
 *     },
 *   });
 * (The adapter is responsible for reporting only NEW edges in `edgesCreated`
 * where that matters for the budget; the crawler treats the number as given.)
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
    const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
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
