import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BaseRole } from '../../../src/services/constellation/RoleTaxonomy.js';

// Mock Prisma (source imports from '../../lib/db.js' -> src/lib/db.js)
vi.mock('../../../src/lib/db.js', () => ({
  default: {
    constellationEdge: { upsert: vi.fn().mockResolvedValue({}) },
    constellationPerson: {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    constellationGenre: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

import prisma from '../../../src/lib/db.js';
import {
  ExpansionService,
  recencyDecay,
  type CreditSource,
} from '../../../src/services/constellation/ExpansionService.js';

type Release = { releaseId: number; masterId: number | null; year: number | null; genres: string[] };
type Credit = { artistId: number; name: string; roles: BaseRole[]; masterId: number | null };

/** Build a fake CreditSource from plain maps. */
function fakeSource(releases: Release[], creditsByRelease: Record<number, Credit[]>): CreditSource {
  return {
    getArtistReleases: async () => releases,
    getReleaseCredits: async (releaseId: number) => creditsByRelease[releaseId] ?? [],
  };
}

const edgeUpsert = () => vi.mocked(prisma.constellationEdge.upsert);

/** Find an upsert call for a given directed edge (source, target). */
function edgeCall(source: number, target: number) {
  return edgeUpsert().mock.calls.find(([arg]: any[]) => {
    const key = arg.where.sourcePersonId_targetPersonId;
    return key.sourcePersonId === source && key.targetPersonId === target;
  })?.[0] as any | undefined;
}

describe('recencyDecay', () => {
  it('returns 1.0 when the year is unknown', () => {
    expect(recencyDecay(null, 2026)).toBe(1.0);
  });
  it('returns 1.0 for the current year (and future/negative clamps to 1.0)', () => {
    expect(recencyDecay(2026, 2026)).toBe(1.0);
    expect(recencyDecay(2030, 2026)).toBe(1.0);
  });
  it('decays linearly with years elapsed', () => {
    expect(recencyDecay(2016, 2026)).toBeCloseTo(0.8, 10); // 1 - 10*0.02
  });
  it('is floored so it never reaches 0', () => {
    expect(recencyDecay(1900, 2026)).toBe(0.3);
  });
});

describe('ExpansionService.expandPerson', () => {
  const P = 1;

  // Two pressings of the SAME master (100) + one distinct master (200).
  const releases: Release[] = [
    { releaseId: 1, masterId: 100, year: null, genres: ['Rock'] },
    { releaseId: 2, masterId: 100, year: null, genres: ['Rock'] }, // reissue of master 100
    { releaseId: 3, masterId: 200, year: null, genres: ['Jazz'] },
  ];

  const P_CREDIT: Credit = { artistId: P, name: 'Person P', roles: ['performer'], masterId: 100 };

  const creditsByRelease: Record<number, Credit[]> = {
    1: [P_CREDIT, { artistId: 10, name: 'X', roles: ['performer'], masterId: 100 }],
    2: [P_CREDIT, { artistId: 10, name: 'X', roles: ['performer'], masterId: 100 }], // X again on the reissue
    3: [
      { ...P_CREDIT, masterId: 200 },
      { artistId: 20, name: 'Y', roles: ['performer'], masterId: 200 },
      { artistId: 194, name: 'Various', roles: ['performer'], masterId: 200 }, // blacklist id
      { artistId: 30, name: 'Unknown Artist', roles: ['performer'], masterId: 200 }, // blacklist name
      { artistId: 40, name: 'Z', roles: [], masterId: 200 }, // zero-weight (no roles)
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    edgeUpsert().mockResolvedValue({} as any);
    vi.mocked(prisma.constellationPerson.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.constellationPerson.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.constellationGenre.upsert).mockResolvedValue({} as any);
  });

  const personCall = (id: number) =>
    vi
      .mocked(prisma.constellationPerson.upsert)
      .mock.calls.find(([arg]: any[]) => arg.where.personId === id)?.[0] as any | undefined;

  it('dedups reissues: shared master count is 1, not 2', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);

    const px = edgeCall(P, 10);
    expect(px).toBeDefined();
    expect(px.create.sharedMasterCount).toBe(1);
    expect(px.update.sharedMasterCount).toBe(1);
  });

  it('creates a separate edge for a collaborator on a different master', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);
    expect(edgeCall(P, 20)).toBeDefined();
  });

  it('writes edges in BOTH directions', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);
    expect(edgeCall(P, 10)).toBeDefined();
    expect(edgeCall(10, P)).toBeDefined();
  });

  it('blacklists Various (id 194) and Unknown Artist (name) — no edges', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);
    expect(edgeCall(P, 194)).toBeUndefined();
    expect(edgeCall(194, P)).toBeUndefined();
    expect(edgeCall(P, 30)).toBeUndefined();
    expect(edgeCall(30, P)).toBeUndefined();
  });

  it('skips zero-weight collaborators whose roles union to empty', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);
    expect(edgeCall(P, 40)).toBeUndefined();
    expect(edgeCall(40, P)).toBeUndefined();
  });

  it('computes deterministic weight = sharedMasterCount * maxRoleWeight * recencyDecay', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);
    const px = edgeCall(P, 10);
    // sharedMasterCount 1, performer weight 1.0, year null -> decay 1.0
    expect(px.create.weight).toBe(1);
    expect(px.update.weight).toBe(1);
    // performer bit set
    expect(px.create.roleBitmask).toBe(1);
  });

  it('upserts a ConstellationPerson for P and each real collaborator (not blacklisted)', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);
    const upsertedIds = vi
      .mocked(prisma.constellationPerson.upsert)
      .mock.calls.map(([arg]: any[]) => arg.where.personId);
    expect(upsertedIds).toContain(P);
    expect(upsertedIds).toContain(10);
    expect(upsertedIds).toContain(20);
    expect(upsertedIds).not.toContain(194);
    expect(upsertedIds).not.toContain(30);
    expect(upsertedIds).not.toContain(40);
  });

  it('weights genres by distinct master (reissues do not inflate affinity)', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);
    const genreCalls = vi
      .mocked(prisma.constellationGenre.upsert)
      .mock.calls.map(([arg]: any[]) => arg.create);
    const rock = genreCalls.find((c: any) => c.genre === 'Rock');
    const jazz = genreCalls.find((c: any) => c.genre === 'Jazz');
    // Two Rock releases share master 100 -> counts once. Jazz on master 200.
    expect(rock?.weight).toBe(1);
    expect(jazz?.weight).toBe(1);
  });

  it('persists P as fullyExpanded (create+update); collaborators are not marked full', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);

    const seed = personCall(P);
    expect(seed.create.fullyExpanded).toBe(true);
    expect(seed.update.fullyExpanded).toBe(true);

    const collab = personCall(10);
    expect(collab.create.fullyExpanded).toBe(false);
    // Collaborator update must NOT touch fullyExpanded (avoids clobbering a Q
    // that was already fully expanded by its own prior expansion).
    expect(collab.update.fullyExpanded).toBeUndefined();
  });

  it('sets bothEndpointsFull only when the collaborator is already full (injected seam)', async () => {
    const svc = new ExpansionService(fakeSource(releases, creditsByRelease), {
      isPersonFull: async (id: number) => id === 10, // X is already full, Y is not
    });
    await svc.expandPerson(P);
    expect(edgeCall(P, 10).create.bothEndpointsFull).toBe(true);
    expect(edgeCall(P, 10).update.bothEndpointsFull).toBe(true);
    expect(edgeCall(10, P).create.bothEndpointsFull).toBe(true);
    expect(edgeCall(P, 20).create.bothEndpointsFull).toBe(false);
  });

  it('default predicate reads persisted fullyExpanded via findUnique', async () => {
    vi.mocked(prisma.constellationPerson.findUnique).mockImplementation(
      (async ({ where }: any) => (where.personId === 10 ? { fullyExpanded: true } : { fullyExpanded: false })) as any,
    );
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);
    expect(edgeCall(P, 10).create.bothEndpointsFull).toBe(true); // Q=10 persisted full
    expect(edgeCall(P, 20).create.bothEndpointsFull).toBe(false); // Q=20 not full
  });

  it('does not expand a blacklisted seed person', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(194);
    expect(edgeUpsert()).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.constellationPerson.upsert)).not.toHaveBeenCalled();
  });

  it('never creates a P->P self-edge', async () => {
    await new ExpansionService(fakeSource(releases, creditsByRelease)).expandPerson(P);
    const selfEdge = edgeUpsert().mock.calls.find(([arg]: any[]) => {
      const key = arg.where.sourcePersonId_targetPersonId;
      return key.sourcePersonId === key.targetPersonId;
    });
    expect(selfEdge).toBeUndefined();
    expect(edgeCall(P, P)).toBeUndefined();
  });

  it('survives a single failing release: other edges still produced, P still fully expanded', async () => {
    // Release 3 (which carries Y) rejects; releases 1 & 2 (X) still succeed.
    const source: CreditSource = {
      getArtistReleases: async () => releases,
      getReleaseCredits: async (releaseId: number) => {
        if (releaseId === 3) throw new Error('boom');
        return creditsByRelease[releaseId] ?? [];
      },
    };
    await new ExpansionService(source).expandPerson(P);

    // X's edge (from the surviving releases) is still produced.
    expect(edgeCall(P, 10)).toBeDefined();
    expect(edgeCall(10, P)).toBeDefined();
    // Y came only from the failing release -> no edge.
    expect(edgeCall(P, 20)).toBeUndefined();
    // P is still upserted as fully expanded despite the failure.
    const seed = personCall(P);
    expect(seed.create.fullyExpanded).toBe(true);
    expect(seed.update.fullyExpanded).toBe(true);
  });

  it('handles an empty release list: P fully expanded, no edges, no throw', async () => {
    const source: CreditSource = {
      getArtistReleases: async () => [],
      getReleaseCredits: async () => [],
    };
    await new ExpansionService(source).expandPerson(P);
    expect(edgeUpsert()).not.toHaveBeenCalled();
    const seed = personCall(P);
    expect(seed.create.fullyExpanded).toBe(true);
    expect(seed.update.fullyExpanded).toBe(true);
  });

  it('applies recency decay through expandPerson via injected nowYear', async () => {
    // A dated collaborator: release from year 2000, evaluated at nowYear 2020.
    const datedReleases: Release[] = [{ releaseId: 5, masterId: 500, year: 2000, genres: [] }];
    const datedCredits: Record<number, Credit[]> = {
      5: [
        { artistId: P, name: 'Person P', roles: ['performer'], masterId: 500 },
        { artistId: 50, name: 'W', roles: ['performer'], masterId: 500 },
      ],
    };
    await new ExpansionService(fakeSource(datedReleases, datedCredits), { nowYear: 2020 }).expandPerson(P);

    const pw = edgeCall(P, 50);
    // decay(2000, 2020) = 1 - 20*0.02 = 0.6; weight = 1 * 1.0 * 0.6
    expect(pw.create.weight).toBeCloseTo(0.6, 10);
    expect(pw.create.weight).toBeLessThan(1);
  });
});
