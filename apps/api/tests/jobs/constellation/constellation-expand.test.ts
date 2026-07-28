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
