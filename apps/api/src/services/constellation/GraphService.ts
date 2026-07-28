import prisma from '../../lib/db.js';
import { createLogger } from '../../lib/logger.js';
import { bridgeScore } from './BridgeScore.js';

const logger = createLogger('GraphService');

export interface GraphNode {
  personId: number;
  displayName: string;
  genre: string | null;
  size: number;
  owned: boolean;
}

export interface GraphEdge {
  source: number;
  target: number;
  weight: number;
  bridge: number | null;
  bridgeConfident: boolean;
  roleBitmask: number;
}

export interface SubgraphResult {
  focusId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SubgraphOpts {
  userId?: number;
  roleMask?: number;
  topN?: number;
  /** Hard ceiling on total nodes (focus + ring-1 + ring-2). */
  maxNodes?: number;
}

/**
 * Optional enrichment seam. Design says size = max(lastfm popularity, credit
 * prominence); lastfm is an OPTIONAL enrichment, so it is injected. When absent,
 * size = credit prominence (sum of the person's outgoing edge weights).
 */
export type GetPopularity = (personId: number) => Promise<number>;

/**
 * Neighbour seam for path finding (mirrors the CreditSource philosophy). Returns
 * the outgoing edges of `personId` as {target, bridge, weight}. Defaults to a
 * real `ConstellationEdge` read (sourcePersonId = personId); tests inject a fake
 * in-memory graph so `path` is unit-testable without Prisma.
 */
export type GetNeighbors = (
  personId: number,
) => Promise<Array<{ target: number; bridge: number | null; weight: number }>>;

export interface GraphServiceDeps {
  getPopularity?: GetPopularity;
  getNeighbors?: GetNeighbors;
}

export interface PathResult {
  nodes: number[];
  degrees: number;
  mode: 'shortest' | 'interesting';
  totalBridge?: number;
}

export interface PathOpts {
  mode?: 'shortest' | 'interesting';
  /** Max degrees (hops) for shortest; interesting may run to max + 2. Default 6. */
  max?: number;
  /**
   * Interesting-mode bound: the search performs at most this many node
   * expansions (getNeighbors calls). Default 500. This is what keeps the
   * bridge-ranked enumeration from exploding on a small-world graph.
   */
  candidateBudget?: number;
}

type EdgeRow = {
  sourcePersonId: number;
  targetPersonId: number;
  weight: number;
  bridge: number | null;
  bridgeConfident: boolean;
  roleBitmask: number;
};

const DEFAULT_TOP_N = 8;
const DEFAULT_MAX_NODES = 50;
const DEFAULT_MAX_DEGREES = 6;
const DEFAULT_CANDIDATE_BUDGET = 500;

/**
 * Read/traversal layer over the constellation graph.
 *
 * `subgraph` produces the dense re-centring field (focus + ~2 rings, <= ~50
 * nodes) with all visual-channel data. `bridgeFill` lazily computes the bridge
 * score only where BOTH endpoints are fully materialised (the confidence gate).
 */
export class GraphService {
  constructor(private readonly deps: GraphServiceDeps = {}) {}

  /**
   * Query approach (batched):
   *   1) focus outgoing edges (1 findMany)               -> ring-1
   *   2) ring-1 nodes' outgoing edges (1 batched findMany) -> pruned ring-2
   *   3) ring-2 nodes' outgoing edges (1 batched findMany) -> prominence only
   *   4) names / genres / owned in parallel (1 findMany each)
   * Credit prominence is accumulated in JS from the edge rows fetched in 1-3.
   * Role-mask filtering is done JS-side (bitwise AND) on the fetched rows.
   */
  async subgraph(focusId: number, opts: SubgraphOpts = {}): Promise<SubgraphResult> {
    const topN = opts.topN ?? DEFAULT_TOP_N;
    const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
    const ring2Cap = Math.max(1, Math.ceil(topN / 2));
    const { roleMask } = opts;

    const passesRole = (e: EdgeRow): boolean =>
      roleMask === undefined || (e.roleBitmask & roleMask) !== 0;

    // Credit prominence = sum of a person's outgoing edge weights, accumulated
    // from every edge row we fetch.
    const prominence = new Map<number, number>();
    const addProminence = (rows: EdgeRow[]): void => {
      for (const e of rows) {
        prominence.set(e.sourcePersonId, (prominence.get(e.sourcePersonId) ?? 0) + e.weight);
      }
    };

    // 1) Focus outgoing edges -> ring-1 (top-N by weight after role filter).
    const focusEdges = (await prisma.constellationEdge.findMany({
      where: { sourcePersonId: focusId },
    })) as EdgeRow[];
    addProminence(focusEdges);

    const ring1Edges = focusEdges
      .filter(passesRole)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, topN);
    const ring1Ids = ring1Edges.map((e) => e.targetPersonId);

    const inGraph = new Set<number>([focusId, ...ring1Ids]);

    // 2) Ring-1 nodes' edges (batched) -> pruned ring-2 candidates.
    const ring2Ids: number[] = [];
    const ring2Edges: EdgeRow[] = [];
    if (ring1Ids.length) {
      const ring1Out = (await prisma.constellationEdge.findMany({
        where: { sourcePersonId: { in: ring1Ids } },
      })) as EdgeRow[];
      addProminence(ring1Out);

      const bySource = new Map<number, EdgeRow[]>();
      for (const e of ring1Out) {
        const arr = bySource.get(e.sourcePersonId);
        if (arr) arr.push(e);
        else bySource.set(e.sourcePersonId, [e]);
      }

      // Process ring-1 in weight order so the cap favours the strongest hubs.
      for (const r1 of ring1Ids) {
        if (inGraph.size >= maxNodes) break;
        const candidates = (bySource.get(r1) ?? [])
          .filter(passesRole)
          .sort((a, b) => b.weight - a.weight);
        let added = 0;
        for (const c of candidates) {
          if (added >= ring2Cap) break;
          if (inGraph.size >= maxNodes) break;
          if (inGraph.has(c.targetPersonId)) continue; // dedupe against focus/ring-1/ring-2
          inGraph.add(c.targetPersonId);
          ring2Ids.push(c.targetPersonId);
          ring2Edges.push(c);
          added += 1;
        }
      }
    }

    // 3) Ring-2 nodes' outgoing edges (prominence only).
    if (ring2Ids.length) {
      const ring2Out = (await prisma.constellationEdge.findMany({
        where: { sourcePersonId: { in: ring2Ids } },
      })) as EdgeRow[];
      addProminence(ring2Out);
    }

    const allNodeIds = [focusId, ...ring1Ids, ...ring2Ids];

    // 4) Batched lookups: names, genres, owned.
    const [persons, genres, owned] = await Promise.all([
      prisma.constellationPerson.findMany({ where: { personId: { in: allNodeIds } } }),
      prisma.constellationGenre.findMany({
        where: { personId: { in: allNodeIds } },
        orderBy: [{ weight: 'desc' }, { genre: 'asc' }],
      }),
      opts.userId !== undefined
        ? prisma.constellationOwned.findMany({
            where: { userId: opts.userId, personId: { in: allNodeIds } },
          })
        : Promise.resolve([] as Array<{ personId: number }>),
    ]);

    const nameById = new Map<number, string>();
    for (const p of persons as Array<{ personId: number; displayName: string }>) {
      nameById.set(p.personId, p.displayName);
    }

    // Dominant genre = highest-weight ConstellationGenre row per person.
    const domGenre = new Map<number, { genre: string; weight: number }>();
    for (const g of genres as Array<{ personId: number; genre: string; weight: number }>) {
      const cur = domGenre.get(g.personId);
      if (!cur || g.weight > cur.weight) domGenre.set(g.personId, { genre: g.genre, weight: g.weight });
    }

    // owned = ANY source row for (userId, personId).
    const ownedSet = new Set<number>();
    for (const o of owned as Array<{ personId: number }>) ownedSet.add(o.personId);

    // Gather popularity for all nodes in parallel (the seam may hit Last.fm).
    // Graceful degradation (Design §9): the popularity seam is an OPTIONAL
    // enrichment. Absent -> size = credit prominence. A THROWING seam (Last.fm
    // outage) must ALSO degrade rather than crash the whole subgraph, so each
    // call is guarded: a rejected popularity lookup falls back to 0 for that
    // node (max(prominence, 0) = prominence), never propagating out of subgraph.
    const { getPopularity } = this.deps;
    const popularities = getPopularity
      ? await Promise.all(
          allNodeIds.map(async (id) => {
            try {
              return await getPopularity(id);
            } catch (err) {
              logger.debug(
                `popularity seam failed for ${id}, falling back to credit prominence: ${err instanceof Error ? err.message : String(err)}`,
              );
              return 0;
            }
          }),
        )
      : [];

    const nodes: GraphNode[] = allNodeIds.map((id, i) => {
      const creditProminence = prominence.get(id) ?? 0;
      const popularity = getPopularity ? popularities[i] : 0;
      return {
        personId: id,
        displayName: nameById.get(id) ?? '',
        genre: domGenre.get(id)?.genre ?? null,
        size: Math.max(creditProminence, popularity),
        owned: ownedSet.has(id),
      };
    });

    // Edges = ring-1 + used ring-2, deduped by directed (source, target).
    const edges: GraphEdge[] = [];
    const seen = new Set<string>();
    for (const e of [...ring1Edges, ...ring2Edges]) {
      const key = `${e.sourcePersonId}->${e.targetPersonId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        source: e.sourcePersonId,
        target: e.targetPersonId,
        weight: e.weight,
        bridge: e.bridge ?? null,
        bridgeConfident: e.bridgeConfident,
        roleBitmask: e.roleBitmask,
      });
    }

    return { focusId, nodes, edges };
  }

  /**
   * Confidence-gated bridge computation. For each undirected endpoint pair:
   * if BOTH endpoints are fully expanded, compute bridgeScore over their
   * neighbour id sets and write bridge + bridgeConfident=true to both directed
   * rows; otherwise write bridgeConfident=false and leave bridge untouched.
   */
  async bridgeFill(edges: Array<{ source: number; target: number }>): Promise<void> {
    // Dedupe symmetric pairs; drop self-loops.
    const pairs: Array<[number, number]> = [];
    const seenPair = new Set<string>();
    for (const { source, target } of edges) {
      if (source === target) continue;
      const key = source < target ? `${source}:${target}` : `${target}:${source}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      pairs.push([source, target]);
    }
    if (!pairs.length) return;

    const endpointIds = [...new Set(pairs.flat())];

    const persons = (await prisma.constellationPerson.findMany({
      where: { personId: { in: endpointIds } },
    })) as Array<{ personId: number; fullyExpanded: boolean }>;
    const fullById = new Map<number, boolean>();
    for (const p of persons) fullById.set(p.personId, !!p.fullyExpanded);

    // Neighbour id sets, only for endpoints that are fully expanded.
    const fullIds = endpointIds.filter((id) => fullById.get(id));
    const neighbors = new Map<number, Set<number>>();
    if (fullIds.length) {
      const rows = (await prisma.constellationEdge.findMany({
        where: { sourcePersonId: { in: fullIds } },
      })) as EdgeRow[];
      for (const e of rows) {
        let s = neighbors.get(e.sourcePersonId);
        if (!s) neighbors.set(e.sourcePersonId, (s = new Set<number>()));
        s.add(e.targetPersonId);
      }
    }

    // Compute each pair's update payload first (pure), then fire the writes in
    // parallel rather than awaiting them serially.
    const updates = pairs.map(([a, b]) => {
      const where = {
        OR: [
          { sourcePersonId: a, targetPersonId: b },
          { sourcePersonId: b, targetPersonId: a },
        ],
      };
      if (fullById.get(a) && fullById.get(b)) {
        const { score } = bridgeScore(
          neighbors.get(a) ?? new Set<number>(),
          neighbors.get(b) ?? new Set<number>(),
          true,
          true,
        );
        return prisma.constellationEdge.updateMany({ where, data: { bridge: score, bridgeConfident: true } });
      }
      return prisma.constellationEdge.updateMany({ where, data: { bridgeConfident: false } });
    });
    await Promise.all(updates);
  }

  /** Default neighbour seam: outgoing ConstellationEdge rows for `personId`. */
  private async defaultGetNeighbors(
    personId: number,
  ): Promise<Array<{ target: number; bridge: number | null; weight: number }>> {
    const rows = (await prisma.constellationEdge.findMany({
      where: { sourcePersonId: personId },
    })) as EdgeRow[];
    return rows.map((e) => ({ target: e.targetPersonId, bridge: e.bridge, weight: e.weight }));
  }

  /**
   * Two "six degrees" modes over the SAME edge data (design §7).
   *
   * - `shortest` (default): bounded, cycle-safe layered BFS. Returns the fewest-hop
   *   path from `fromId` to `toId` within `max` degrees (default 6), or `null` if
   *   unreachable within `max` (it bails — it does NOT traverse further). Cheap; the
   *   shortest route typically threads through hubs.
   *
   * - `interesting`: bounded, bridge-ranked path enumeration. Explores simple paths
   *   up to `max + 2` degrees via depth-first search and returns the one with the
   *   highest cumulative bridge score (sum of edge `bridge`, null treated as 0),
   *   surfacing boundary-crossing chains even when they are longer than the shortest
   *   route. TERMINATION: the search performs at most `candidateBudget` node
   *   expansions (getNeighbors calls, default 500); combined with simple-path
   *   (no-revisit) pruning and the `max + 2` depth cap this provably terminates and
   *   cannot blow up exponentially on a small-world graph.
   */
  async path(fromId: number, toId: number, opts: PathOpts = {}): Promise<PathResult | null> {
    const mode = opts.mode ?? 'shortest';
    const max = opts.max ?? DEFAULT_MAX_DEGREES;
    const getNeighbors = this.deps.getNeighbors ?? ((id: number) => this.defaultGetNeighbors(id));

    if (fromId === toId) {
      return mode === 'interesting'
        ? { nodes: [fromId], degrees: 0, mode, totalBridge: 0 }
        : { nodes: [fromId], degrees: 0, mode };
    }

    return mode === 'interesting'
      ? this.interestingPath(fromId, toId, max, opts.candidateBudget ?? DEFAULT_CANDIDATE_BUDGET, getNeighbors)
      : this.shortestPath(fromId, toId, max, getNeighbors);
  }

  /** Layered BFS: fewest hops, cycle-safe, bails to null past `max` degrees. */
  private async shortestPath(
    fromId: number,
    toId: number,
    max: number,
    getNeighbors: GetNeighbors,
  ): Promise<PathResult | null> {
    const visited = new Set<number>([fromId]);
    let frontier: number[][] = [[fromId]];

    while (frontier.length) {
      const next: number[][] = [];
      for (const path of frontier) {
        const hops = path.length - 1;
        if (hops >= max) continue; // extending would exceed the degree budget
        const last = path[path.length - 1];
        for (const nb of await getNeighbors(last)) {
          if (nb.target === toId) {
            return { nodes: [...path, toId], degrees: hops + 1, mode: 'shortest' };
          }
          if (!visited.has(nb.target)) {
            visited.add(nb.target);
            next.push([...path, nb.target]);
          }
        }
      }
      frontier = next;
    }
    return null;
  }

  /**
   * Bounded DFS over simple paths (length <= max + 2), ranked by cumulative bridge.
   * At most `budget` node expansions are performed, so getNeighbors is called <=
   * budget times — the analog of the OrbitCrawler edge budget.
   */
  private async interestingPath(
    fromId: number,
    toId: number,
    max: number,
    budget: number,
    getNeighbors: GetNeighbors,
  ): Promise<PathResult | null> {
    const maxDepth = max + 2; // hops allowed for the "interesting" (longer) route
    let best: { nodes: number[]; totalBridge: number } | null = null;
    let expansions = 0;
    let budgetExhausted = false;

    // LIFO stack of partial simple paths; each carries its running bridge sum.
    const stack: Array<{ path: number[]; bridgeSum: number; onPath: Set<number> }> = [
      { path: [fromId], bridgeSum: 0, onPath: new Set([fromId]) },
    ];

    while (stack.length) {
      if (expansions >= budget) {
        budgetExhausted = true; // stopped by the bound, not by exhausting the graph
        break;
      }
      const frame = stack.pop()!;
      const last = frame.path[frame.path.length - 1];

      if (last === toId) {
        const better =
          best === null ||
          frame.bridgeSum > best.totalBridge ||
          (frame.bridgeSum === best.totalBridge && frame.path.length < best.nodes.length);
        if (better) best = { nodes: frame.path, totalBridge: frame.bridgeSum };
        continue; // do not expand past the target
      }
      if (frame.path.length - 1 >= maxDepth) continue; // depth cap reached

      expansions += 1;
      for (const nb of await getNeighbors(last)) {
        if (frame.onPath.has(nb.target)) continue; // keep paths simple (cycle-safe)
        const onPath = new Set(frame.onPath);
        onPath.add(nb.target);
        stack.push({
          path: [...frame.path, nb.target],
          bridgeSum: frame.bridgeSum + (nb.bridge ?? 0),
          onPath,
        });
      }
    }

    if (!best) {
      if (budgetExhausted) {
        // Distinguish "budget too small" from "genuinely no path" in the field.
        logger.warn(
          `interesting path ${fromId}->${toId} gave up: candidate budget (${budget} expansions) exhausted before reaching target (max ${maxDepth} hops)`,
        );
      }
      return null;
    }
    return { nodes: best.nodes, degrees: best.nodes.length - 1, mode: 'interesting', totalBridge: best.totalBridge };
  }
}
