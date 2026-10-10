import { describe, it, expect, vi } from 'vitest';
import { runExpandJob } from '../../../src/jobs/constellation/constellation-expand-worker.js';

function neighbors() {
  return {
    nodes: [{ personId: 2, displayName: 'B' }],
    edges: [{ source: 1, target: 2, weight: 3 }],
  };
}

describe('runExpandJob', () => {
  it('expands the person, reads neighbors, and publishes when a token is present', async () => {
    const expandPerson = vi.fn(async () => {});
    const getNeighbors = vi.fn(async () => neighbors());
    const publish = vi.fn();

    const result = await runExpandJob({
      artistId: 1,
      tokenId: 'tok-1',
      generation: 4,
      expandService: { expandPerson },
      getNeighbors,
      publish,
    });

    expect(expandPerson).toHaveBeenCalledWith(1);
    expect(getNeighbors).toHaveBeenCalledWith(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('tok-1', 4, {
      focusId: 1,
      nodes: neighbors().nodes,
      edges: neighbors().edges,
    });
    expect(result).toEqual({ artistId: 1, published: true, nodeCount: 1, edgeCount: 1 });
  });

  it('does NOT publish when no token is present', async () => {
    const expandPerson = vi.fn(async () => {});
    const getNeighbors = vi.fn(async () => neighbors());
    const publish = vi.fn();

    const result = await runExpandJob({
      artistId: 9,
      expandService: { expandPerson },
      getNeighbors,
      publish,
    });

    expect(expandPerson).toHaveBeenCalledWith(9);
    expect(getNeighbors).toHaveBeenCalledWith(9);
    expect(publish).not.toHaveBeenCalled();
    expect(result).toEqual({ artistId: 9, published: false, nodeCount: 1, edgeCount: 1 });
  });

  it('defaults the generation to 1 when a token is present but no generation is given', async () => {
    const publish = vi.fn();

    await runExpandJob({
      artistId: 5,
      tokenId: 'tok-2',
      expandService: { expandPerson: async () => {} },
      getNeighbors: async () => ({ nodes: [], edges: [] }),
      publish,
    });

    expect(publish).toHaveBeenCalledWith('tok-2', 1, { focusId: 5, nodes: [], edges: [] });
  });

  it('expands before reading neighbors (materialize then publish ordering)', async () => {
    const order: string[] = [];
    const publish = vi.fn(() => order.push('publish'));

    await runExpandJob({
      artistId: 1,
      tokenId: 't',
      generation: 1,
      expandService: { expandPerson: async () => { order.push('expand'); } },
      getNeighbors: async () => { order.push('read'); return { nodes: [], edges: [] }; },
      publish,
    });

    expect(order).toEqual(['expand', 'read', 'publish']);
  });
});

describe('constellation-expand-worker module import', () => {
  it('does not open a Redis connection at import time', async () => {
    const mod = await import('../../../src/jobs/constellation/constellation-expand-worker.js');
    expect(typeof mod.runExpandJob).toBe('function');
    expect(typeof mod.registerConstellationExpandWorker).toBe('function');
  });
});

const shell = vi.hoisted(() => ({
  process: null as null | ((job: any) => Promise<unknown>),
  subgraph: vi.fn(), settings: vi.fn(), close: vi.fn(), expand: vi.fn(),
  redis: vi.fn(), publish: vi.fn(), resolve: vi.fn(), expansionOptions: {} as { strict?: boolean },
}));
vi.mock('bullmq', () => ({ Worker: class {
  constructor(_name: string, process: (job: any) => Promise<unknown>) { shell.process = process; }
  on() { return this; }
} }));
vi.mock('../../../src/lib/redis.js', () => ({ createRedisConnection: shell.redis }));
vi.mock('../../../src/jobs/constellation/queue.js', () => ({ CONSTELLATION_QUEUE_NAMES: { EXPAND: 'constellation-expand' } }));
vi.mock('../../../src/services/constellation/ExpansionService.js', () => ({ ExpansionService: class { constructor(_source: unknown, options: { strict?: boolean }) { shell.expansionOptions = options; } expandPerson = shell.expand; } }));
vi.mock('../../../src/services/constellation/GraphService.js', () => ({ GraphService: class { subgraph = shell.subgraph; } }));
vi.mock('../../../src/services/settings.service.js', () => ({ SettingsService: { getConstellationSettings: shell.settings } }));
vi.mock('../../../src/services/constellation/resolveCreditSource.js', () => ({ resolveConfiguredCreditSource: shell.resolve }));
vi.mock('../../../src/routes/constellation.js', () => ({ publishToStream: shell.publish }));

describe('registered expand worker settings wiring', () => {
  it.each([4, 500])('uses the stored fan-out %s in the actual worker closure and closes its source', async fanoutN => {
    vi.clearAllMocks();
    shell.resolve.mockResolvedValue({ close: shell.close }); shell.expand.mockResolvedValue(undefined);
    shell.settings.mockResolvedValue({ fanoutN }); shell.subgraph.mockResolvedValue(neighbors());
    const { registerConstellationExpandWorker } = await import('../../../src/jobs/constellation/constellation-expand-worker.js');
    await registerConstellationExpandWorker();
    await shell.process!({ data: { artistId: 42, tokenId: 'token', generation: 2 }, updateProgress: vi.fn() });
    expect(shell.settings).toHaveBeenCalledTimes(1);
    expect(shell.subgraph).toHaveBeenCalledWith(42, { topN: Math.min(fanoutN, 49), maxNodes: 50 });
    expect(shell.publish).toHaveBeenCalledWith('token', 2, { focusId: 42, ...neighbors() });
    expect(shell.close).toHaveBeenCalledTimes(1);
  });
});

describe('registered worker availability and source lifecycle', () => {
  it.each(['setup', 'expand', 'read', 'budget'])('publishes correlated %s failure, returns without throwing, and closes only owned handles', async phase => {
    vi.clearAllMocks(); shell.resolve.mockReset(); shell.expand.mockReset(); shell.subgraph.mockReset(); shell.close.mockReset();
    const { ApiBudgetExhaustedError } = await import('../../../src/services/constellation/DailyApiBudget.js');
    const error = phase === 'budget' ? new ApiBudgetExhaustedError(5000, '2026-10-09') : new Error('private token=secret /private/path');
    shell.resolve.mockResolvedValue({ close: shell.close }); shell.expand.mockResolvedValue(undefined); shell.subgraph.mockResolvedValue(neighbors()); shell.settings.mockResolvedValue({ fanoutN: 8 });
    if (phase === 'setup') shell.resolve.mockRejectedValue(error);
    else if (phase === 'read') shell.subgraph.mockRejectedValue(error);
    else shell.expand.mockRejectedValue(error);
    shell.close.mockImplementation(() => { throw new Error('cleanup failed'); });
    const { registerConstellationExpandWorker } = await import('../../../src/jobs/constellation/constellation-expand-worker.js'); await registerConstellationExpandWorker();
    const result = await shell.process!({ data: { artistId: 42, tokenId: 'token', generation: 3 }, updateProgress: vi.fn().mockRejectedValue(new Error('progress failed')) });
    expect(result).toMatchObject({ artistId: 42, status: phase === 'budget' ? 'budget-exhausted' : 'source-unavailable' });
    expect(shell.publish).toHaveBeenCalledWith('token', 3, { focusId: 42, nodes: [], edges: [], status: phase === 'budget' ? 'budget-exhausted' : 'source-unavailable', ...(phase === 'budget' ? {} : { detail: 'Collaborator source is unavailable. Please retry.' }) });
    expect(shell.close).toHaveBeenCalledTimes(phase === 'setup' ? 0 : 1);
    expect(shell.resolve).toHaveBeenCalledWith();
  });
  it('the registered worker observes failures through the real ExpansionService', async () => {
    vi.clearAllMocks(); shell.close.mockReset(); shell.resolve.mockReset();
    // The imported actual class is used behind the orchestration seam, so this
    // assertion catches provider failures swallowed inside the service itself.
    const actual = await vi.importActual<typeof import('../../../src/services/constellation/ExpansionService.js')>('../../../src/services/constellation/ExpansionService.js');
    const source = { getArtistReleases: vi.fn().mockRejectedValue(new Error('Discogs down')), getReleaseCredits: vi.fn(), close: shell.close };
    shell.resolve.mockResolvedValue(source);
    shell.expand.mockImplementation(id => new actual.ExpansionService(source, shell.expansionOptions).expandPerson(id));
    const { registerConstellationExpandWorker } = await import('../../../src/jobs/constellation/constellation-expand-worker.js'); await registerConstellationExpandWorker();
    const result = await shell.process!({ data: { artistId: 42, tokenId: 'token', generation: 1 }, updateProgress: vi.fn() });
    expect(source.getArtistReleases).toHaveBeenCalledWith(42); expect(result).toMatchObject({ status: 'source-unavailable' }); expect(shell.close).toHaveBeenCalledOnce();
  });
});
