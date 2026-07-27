/**
 * A stateful, in-memory stand-in for the Prisma client subset that the
 * constellation services actually call. There is no live database in the test
 * environment (migrations cannot run), so this fake gives ExpansionService a
 * place to WRITE and GraphService/IdentityService a place to READ over the SAME
 * backing Maps — letting the real services compose end-to-end.
 *
 * It implements ONLY the methods enumerated from a grep of the constellation
 * services (see the e2e test header), with correct-enough semantics for the
 * exact queries those callers make:
 *
 *   constellationEdge     upsert, findMany (where.sourcePersonId as number|{in}),
 *                         updateMany (where as {source,target} or {OR:[...]})
 *   constellationPerson   upsert, findUnique (where.personId), findMany (where.personId {in}|number)
 *   constellationGenre    upsert (where.personId_genre), findMany (where.personId {in}, orderBy)
 *   constellationOwned    upsert (where.userId_personId_source), findMany (where.userId + personId {in})
 *   constellationIdentity findUnique (where.personId_source), findFirst (where {source,externalId}), upsert
 *
 * Each call returns a shallow COPY of the stored row(s) so callers cannot mutate
 * store state by reference (matching Prisma's value semantics).
 */

export interface EdgeRow {
  sourcePersonId: number;
  targetPersonId: number;
  weight: number;
  roleBitmask: number;
  sharedMasterCount: number;
  sampleMasterId: number | null;
  bothEndpointsFull: boolean;
  bridge: number | null;
  bridgeConfident: boolean;
  fetchedAt: Date;
}

export interface PersonRow {
  personId: number;
  displayName: string;
  fullyExpanded: boolean;
}

export interface GenreRow {
  personId: number;
  genre: string;
  weight: number;
}

export interface OwnedRow {
  userId: number;
  personId: number;
  source: string;
}

export interface IdentityRow {
  personId: number;
  source: string;
  externalId: string;
  confidence: string;
}

/** Matches a scalar `where` field that is either an equality or `{ in: [...] }`. */
function scalarMatch(field: unknown, value: number): boolean {
  if (field && typeof field === 'object' && Array.isArray((field as { in?: number[] }).in)) {
    return (field as { in: number[] }).in.includes(value);
  }
  if (field === undefined) return true; // absent field => no constraint
  return field === value;
}

const copy = <T>(row: T): T => ({ ...row });

/**
 * Build a fresh in-memory constellation Prisma subset. Each call returns an
 * independent store (its own Maps) so tests get isolation by constructing a new
 * one per case.
 */
export function makeInMemoryConstellationPrisma() {
  // Composite/primary keys:
  //   edge     -> `${source}->${target}`
  //   person   -> personId
  //   genre    -> `${personId}::${genre}`
  //   owned    -> `${userId}::${personId}::${source}`
  //   identity -> `${personId}::${source}`
  const edges = new Map<string, EdgeRow>();
  const persons = new Map<number, PersonRow>();
  const genres = new Map<string, GenreRow>();
  const owned = new Map<string, OwnedRow>();
  const identities = new Map<string, IdentityRow>();

  const edgeKey = (s: number, t: number) => `${s}->${t}`;
  const genreKey = (p: number, g: string) => `${p}::${g}`;
  const ownedKey = (u: number, p: number, s: string) => `${u}::${p}::${s}`;
  const identityKey = (p: number, s: string) => `${p}::${s}`;

  const constellationEdge = {
    async upsert({ where, create, update }: any): Promise<EdgeRow> {
      const { sourcePersonId, targetPersonId } = where.sourcePersonId_targetPersonId;
      const key = edgeKey(sourcePersonId, targetPersonId);
      const existing = edges.get(key);
      const row: EdgeRow = existing
        ? { ...existing, ...update }
        : {
            bridge: null,
            bridgeConfident: false,
            sampleMasterId: null,
            ...create,
          };
      edges.set(key, row);
      return copy(row);
    },

    async findMany({ where }: any = {}): Promise<EdgeRow[]> {
      const src = where?.sourcePersonId;
      return [...edges.values()]
        .filter((e) => src === undefined || scalarMatch(src, e.sourcePersonId))
        .map(copy);
    },

    async updateMany({ where, data }: any): Promise<{ count: number }> {
      // Two shapes are used: a direct {sourcePersonId,targetPersonId} and the
      // symmetric {OR:[{s,t},{t,s}]} used by bridgeFill.
      const matchers: Array<(e: EdgeRow) => boolean> = [];
      if (Array.isArray(where?.OR)) {
        for (const clause of where.OR) {
          matchers.push(
            (e) => e.sourcePersonId === clause.sourcePersonId && e.targetPersonId === clause.targetPersonId,
          );
        }
      } else if (where) {
        matchers.push(
          (e) => e.sourcePersonId === where.sourcePersonId && e.targetPersonId === where.targetPersonId,
        );
      }
      let count = 0;
      for (const [key, e] of edges) {
        if (matchers.some((m) => m(e))) {
          edges.set(key, { ...e, ...data });
          count += 1;
        }
      }
      return { count };
    },
  };

  const constellationPerson = {
    async upsert({ where, create, update }: any): Promise<PersonRow> {
      const { personId } = where;
      const existing = persons.get(personId);
      const row: PersonRow = existing ? { ...existing, ...update } : { fullyExpanded: false, ...create };
      persons.set(personId, row);
      return copy(row);
    },

    async findUnique({ where }: any): Promise<PersonRow | null> {
      const row = persons.get(where.personId);
      return row ? copy(row) : null;
    },

    async findMany({ where }: any = {}): Promise<PersonRow[]> {
      const pid = where?.personId;
      return [...persons.values()].filter((p) => scalarMatch(pid, p.personId)).map(copy);
    },
  };

  const constellationGenre = {
    async upsert({ where, create, update }: any): Promise<GenreRow> {
      const { personId, genre } = where.personId_genre;
      const key = genreKey(personId, genre);
      const existing = genres.get(key);
      const row: GenreRow = existing ? { ...existing, ...update } : { ...create };
      genres.set(key, row);
      return copy(row);
    },

    async findMany({ where, orderBy }: any = {}): Promise<GenreRow[]> {
      const pid = where?.personId;
      let rows = [...genres.values()].filter((g) => scalarMatch(pid, g.personId)).map(copy);
      // Only the orderBy actually used by GraphService: [{weight:'desc'},{genre:'asc'}].
      if (Array.isArray(orderBy)) {
        rows = rows.sort((a, b) => {
          for (const clause of orderBy) {
            if (clause.weight) {
              const d = clause.weight === 'desc' ? b.weight - a.weight : a.weight - b.weight;
              if (d !== 0) return d;
            }
            if (clause.genre) {
              const d = a.genre < b.genre ? -1 : a.genre > b.genre ? 1 : 0;
              if (d !== 0) return clause.genre === 'desc' ? -d : d;
            }
          }
          return 0;
        });
      }
      return rows;
    },
  };

  const constellationOwned = {
    async upsert({ where, create, update }: any): Promise<OwnedRow> {
      const { userId, personId, source } = where.userId_personId_source;
      const key = ownedKey(userId, personId, source);
      const existing = owned.get(key);
      const row: OwnedRow = existing ? { ...existing, ...update } : { ...create };
      owned.set(key, row);
      return copy(row);
    },

    async findMany({ where }: any = {}): Promise<OwnedRow[]> {
      const pid = where?.personId;
      return [...owned.values()]
        .filter((o) => (where?.userId === undefined || o.userId === where.userId) && scalarMatch(pid, o.personId))
        .map(copy);
    },
  };

  const constellationIdentity = {
    async findUnique({ where }: any): Promise<IdentityRow | null> {
      const { personId, source } = where.personId_source;
      const row = identities.get(identityKey(personId, source));
      return row ? copy(row) : null;
    },

    async findFirst({ where }: any): Promise<IdentityRow | null> {
      const row = [...identities.values()].find(
        (i) =>
          (where?.source === undefined || i.source === where.source) &&
          (where?.externalId === undefined || i.externalId === where.externalId) &&
          (where?.personId === undefined || i.personId === where.personId),
      );
      return row ? copy(row) : null;
    },

    async upsert({ where, create, update }: any): Promise<IdentityRow> {
      const { personId, source } = where.personId_source;
      const key = identityKey(personId, source);
      const existing = identities.get(key);
      const row: IdentityRow = existing ? { ...existing, ...update } : { ...create };
      identities.set(key, row);
      return copy(row);
    },
  };

  return {
    constellationEdge,
    constellationPerson,
    constellationGenre,
    constellationOwned,
    constellationIdentity,
    // Test-only introspection helpers (not part of the Prisma surface).
    _raw: { edges, persons, genres, owned, identities },
  };
}

export type InMemoryConstellationPrisma = ReturnType<typeof makeInMemoryConstellationPrisma>;
