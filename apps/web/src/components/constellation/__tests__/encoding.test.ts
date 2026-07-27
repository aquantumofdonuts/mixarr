import { describe, it, expect } from 'vitest';
import {
  genreColor,
  nodeRadius,
  edgeWidth,
  edgeColor,
  ownedRingStyle,
  genreHighlightAlpha,
  GENRE_DIMMED_ALPHA,
  GENRE_LEGEND,
  NEUTRAL_GENRE_COLOR,
  NODE_RADIUS_MIN,
  NODE_RADIUS_MAX,
  EDGE_WIDTH_MIN,
  EDGE_WIDTH_MAX,
  NEUTRAL_EDGE_COLOR,
} from '../encoding';

/** Parse the alpha channel out of an `rgba(r,g,b,a)` string. */
function alphaOf(rgba: string): number {
  const match = rgba.match(/rgba?\([^)]*,\s*([0-9.]+)\s*\)/);
  if (!match) throw new Error(`not an rgba string: ${rgba}`);
  return Number(match[1]);
}

describe('genreColor', () => {
  it('is deterministic for the same genre', () => {
    expect(genreColor('rock')).toBe(genreColor('rock'));
    expect(genreColor('jazz')).toBe(genreColor('jazz'));
  });

  it('is case- and whitespace-insensitive', () => {
    expect(genreColor('Rock')).toBe(genreColor('rock'));
    expect(genreColor('  JAZZ ')).toBe(genreColor('jazz'));
  });

  it('maps distinct known genres to distinct colors', () => {
    expect(genreColor('rock')).not.toBe(genreColor('jazz'));
    expect(genreColor('electronic')).not.toBe(genreColor('classical'));
  });

  it('returns the neutral gray for null (cross-genre artist renders neutral)', () => {
    expect(genreColor(null)).toBe(NEUTRAL_GENRE_COLOR);
  });

  it('returns the neutral gray for an unknown genre', () => {
    expect(genreColor('totally-made-up-genre-xyz')).toBe(NEUTRAL_GENRE_COLOR);
  });

  it('known-genre colors are not the neutral gray', () => {
    expect(genreColor('rock')).not.toBe(NEUTRAL_GENRE_COLOR);
  });
});

describe('nodeRadius', () => {
  it('maps a leaf (size 0) to the minimum radius, never 0/invisible', () => {
    expect(nodeRadius(0)).toBe(NODE_RADIUS_MIN);
    expect(nodeRadius(0)).toBeGreaterThan(0);
  });

  it('stays within [min, max] for any size', () => {
    for (const size of [0, 1, 10, 50, 100, 1000, -5]) {
      const r = nodeRadius(size);
      expect(r).toBeGreaterThanOrEqual(NODE_RADIUS_MIN);
      expect(r).toBeLessThanOrEqual(NODE_RADIUS_MAX);
    }
  });

  it('grows monotonically with size', () => {
    expect(nodeRadius(50)).toBeGreaterThan(nodeRadius(5));
    expect(nodeRadius(5)).toBeGreaterThan(nodeRadius(0));
  });

  it('caps large sizes at the maximum radius', () => {
    expect(nodeRadius(100000)).toBe(NODE_RADIUS_MAX);
  });

  it('returns a uniform radius when hideHotness is set (independent of size)', () => {
    const a = nodeRadius(0, { hideHotness: true });
    const b = nodeRadius(100, { hideHotness: true });
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(NODE_RADIUS_MIN);
    expect(a).toBeLessThanOrEqual(NODE_RADIUS_MAX);
  });
});

describe('edgeWidth', () => {
  it('stays within [min, max] for any weight', () => {
    for (const weight of [0, 1, 5, 10, 100, -3]) {
      const w = edgeWidth(weight);
      expect(w).toBeGreaterThanOrEqual(EDGE_WIDTH_MIN);
      expect(w).toBeLessThanOrEqual(EDGE_WIDTH_MAX);
    }
  });

  it('maps a zero/weak tie to the minimum width', () => {
    expect(edgeWidth(0)).toBe(EDGE_WIDTH_MIN);
  });

  it('grows with weight and caps at the maximum', () => {
    expect(edgeWidth(5)).toBeGreaterThan(edgeWidth(1));
    expect(edgeWidth(100000)).toBe(EDGE_WIDTH_MAX);
  });
});

describe('edgeColor', () => {
  it('renders focus links in a reddish color', () => {
    const color = edgeColor({ bridge: null, bridgeConfident: false }, true);
    expect(color).not.toBe(NEUTRAL_EDGE_COLOR);
    // reddish => red channel dominates
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('glows warm ONLY when the bridge is confident', () => {
    const confident = edgeColor({ bridge: 0.8, bridgeConfident: true }, false);
    const notConfident = edgeColor({ bridge: 0.8, bridgeConfident: false }, false);
    expect(confident).not.toBe(NEUTRAL_EDGE_COLOR);
    // a non-confident bridge is gated off -> neutral, even with a high bridge score
    expect(notConfident).toBe(NEUTRAL_EDGE_COLOR);
  });

  it('does not glow when bridge is null even if flagged confident', () => {
    expect(edgeColor({ bridge: null, bridgeConfident: true }, false)).toBe(NEUTRAL_EDGE_COLOR);
  });

  it('scales the glow intensity with the bridge score', () => {
    const strong = edgeColor({ bridge: 0.9, bridgeConfident: true }, false);
    const weak = edgeColor({ bridge: 0.1, bridgeConfident: true }, false);
    expect(alphaOf(strong)).toBeGreaterThan(alphaOf(weak));
  });

  it('renders normal (non-bridge) edges in the neutral color', () => {
    expect(edgeColor({ bridge: null, bridgeConfident: false }, false)).toBe(NEUTRAL_EDGE_COLOR);
  });
});

describe('genreHighlightAlpha', () => {
  it('is fully opaque for every node when nothing is highlighted', () => {
    expect(genreHighlightAlpha('rock', null)).toBe(1);
    expect(genreHighlightAlpha(null, null)).toBe(1);
  });

  it('keeps the matching genre fully opaque and dims the rest', () => {
    expect(genreHighlightAlpha('rock', 'rock')).toBe(1);
    expect(genreHighlightAlpha('Rock', 'rock')).toBe(1); // case-insensitive
    expect(genreHighlightAlpha('jazz', 'rock')).toBe(GENRE_DIMMED_ALPHA);
  });

  it('dims null-genre nodes against a specific highlight', () => {
    expect(genreHighlightAlpha(null, 'rock')).toBe(GENRE_DIMMED_ALPHA);
  });
});

describe('GENRE_LEGEND', () => {
  it('lists canonical genres with their palette colors', () => {
    expect(GENRE_LEGEND.length).toBeGreaterThan(0);
    for (const entry of GENRE_LEGEND) {
      expect(typeof entry.genre).toBe('string');
      expect(entry.color).toBe(genreColor(entry.genre));
    }
    expect(GENRE_LEGEND.map((e) => e.genre)).toContain('rock');
  });
});

describe('ownedRingStyle', () => {
  it('returns a ring spec for owned nodes', () => {
    const ring = ownedRingStyle(true);
    expect(ring).not.toBeNull();
    expect(ring!.width).toBeGreaterThan(0);
    expect(typeof ring!.stroke).toBe('string');
  });

  it('returns null for un-owned nodes', () => {
    expect(ownedRingStyle(false)).toBeNull();
  });
});
