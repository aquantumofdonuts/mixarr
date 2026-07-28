/**
 * Pure visual-encoding functions for the Collaboration Constellation graph.
 *
 * These translate the honest data channels from the design (§8) into concrete
 * canvas paint values: genre -> color, prominence -> radius, tie strength ->
 * line width, confident bridge -> warm glow, ownership -> ring. They are kept
 * free of canvas / React so they can be unit-tested without a DOM.
 */

// ---------------------------------------------------------------------------
// Genre -> color
// ---------------------------------------------------------------------------

/**
 * Neutral gray for the "cross-genre artist renders neutral" rule: a node with
 * no single dominant genre (`null`) or an unrecognised genre gets this instead
 * of a misleading category color.
 */
export const NEUTRAL_GENRE_COLOR = '#8a8f98';

/**
 * Curated mid-level genre palette. Colors are mid-saturation / mid-luminance so
 * the field reads as a cohesive constellation rather than a neon scatter, and
 * each hue is distinct enough to tell neighbouring genres apart. Synonyms map to
 * the same hue (e.g. `rap` -> hip hop, `soul` -> r&b) so the coloring is stable
 * across the backend's genre spellings.
 */
const GENRE_PALETTE: Record<string, string> = {
  rock: '#b5443a',
  metal: '#5b5f6b',
  punk: '#c43e63',
  pop: '#e0669b',
  'hip hop': '#d98a3d',
  'hip-hop': '#d98a3d',
  hiphop: '#d98a3d',
  rap: '#d98a3d',
  electronic: '#3fa9b4',
  edm: '#3fa9b4',
  dance: '#3fa9b4',
  'r&b': '#8e5ba6',
  rnb: '#8e5ba6',
  soul: '#8e5ba6',
  funk: '#a86f9c',
  jazz: '#c99742',
  blues: '#3e6da8',
  classical: '#9c8a5a',
  country: '#b98a4c',
  folk: '#7a9a5b',
  reggae: '#4fa05a',
  indie: '#6b8fb5',
  latin: '#d96a4a',
};

/**
 * Deterministic color for a genre. Same (normalised) genre always yields the
 * same color; `null` or an unknown genre yields {@link NEUTRAL_GENRE_COLOR}.
 */
export function genreColor(genre: string | null): string {
  if (genre === null) return NEUTRAL_GENRE_COLOR;
  const key = genre.trim().toLowerCase();
  return GENRE_PALETTE[key] ?? NEUTRAL_GENRE_COLOR;
}

/**
 * Canonical genre → swatch color list for the controls legend / highlight
 * picker. Synonyms (rap/soul/edm…) are collapsed to their canonical spelling so
 * the legend shows one entry per hue, in a stable display order.
 */
export const GENRE_LEGEND: ReadonlyArray<{ genre: string; color: string }> = Object.freeze(
  [
    'rock',
    'metal',
    'punk',
    'pop',
    'hip hop',
    'electronic',
    'r&b',
    'funk',
    'jazz',
    'blues',
    'classical',
    'country',
    'folk',
    'reggae',
    'indie',
    'latin',
  ].map((genre) => ({ genre, color: genreColor(genre) })),
);

/**
 * Opacity applied to a node that does NOT match the active genre highlight.
 * Non-matching nodes are dimmed (not hidden) so the field's structure is still
 * legible while the highlighted genre is traced across it.
 */
export const GENRE_DIMMED_ALPHA = 0.12;

/**
 * Per-node alpha for the genre-highlight overlay. When no genre is highlighted
 * (`highlight === null`) every node paints at full opacity; otherwise nodes
 * whose (normalised) genre differs from the highlight are dimmed. `null`-genre
 * nodes never match a specific highlight, so they dim too.
 */
export function genreHighlightAlpha(
  nodeGenre: string | null,
  highlight: string | null,
): number {
  if (highlight === null) return 1;
  if (nodeGenre === null) return GENRE_DIMMED_ALPHA;
  return nodeGenre.trim().toLowerCase() === highlight.trim().toLowerCase()
    ? 1
    : GENRE_DIMMED_ALPHA;
}

// ---------------------------------------------------------------------------
// Prominence -> node radius
// ---------------------------------------------------------------------------

/** Smallest node radius. A leaf (size 0) maps here so it is never invisible. */
export const NODE_RADIUS_MIN = 4;
/** Largest node radius, for a maximally prominent node. */
export const NODE_RADIUS_MAX = 20;
/** Uniform radius used when the hotness (size) channel is hidden. */
export const NODE_RADIUS_UNIFORM = 8;
/** Size treated as "fully prominent" — anything at/above maps to the max. */
const NODE_SIZE_REFERENCE = 100;

/**
 * Map prominence `size` to a radius in `[NODE_RADIUS_MIN, NODE_RADIUS_MAX]`.
 *
 * A `sqrt` curve keeps mid-prominence nodes visually distinct (perceived area
 * scales roughly with the value) while still capping the biggest ones. Size 0
 * maps to the minimum (never 0), and `hideHotness` collapses every node to a
 * single uniform radius.
 */
export function nodeRadius(size: number, opts: { hideHotness?: boolean } = {}): number {
  if (opts.hideHotness) return NODE_RADIUS_UNIFORM;
  const t = Math.max(0, Math.min(1, size / NODE_SIZE_REFERENCE));
  return NODE_RADIUS_MIN + (NODE_RADIUS_MAX - NODE_RADIUS_MIN) * Math.sqrt(t);
}

// ---------------------------------------------------------------------------
// Tie strength -> edge width
// ---------------------------------------------------------------------------

/** Thinnest edge, for a weak / single collaboration. */
export const EDGE_WIDTH_MIN = 1;
/** Thickest edge, for a very strong tie. */
export const EDGE_WIDTH_MAX = 6;
/** Weight treated as "fully strong" — anything at/above maps to the max width. */
const EDGE_WEIGHT_REFERENCE = 10;

/** Map collaboration `weight` to a line width in `[EDGE_WIDTH_MIN, EDGE_WIDTH_MAX]`. */
export function edgeWidth(weight: number): number {
  const t = Math.max(0, Math.min(1, weight / EDGE_WEIGHT_REFERENCE));
  return EDGE_WIDTH_MIN + (EDGE_WIDTH_MAX - EDGE_WIDTH_MIN) * t;
}

// ---------------------------------------------------------------------------
// Edge color (focus links + confident-bridge glow)
// ---------------------------------------------------------------------------

/** Reddish color for links incident to the current focus node. */
export const FOCUS_EDGE_COLOR = 'rgba(224, 83, 58, 0.9)';
/** Neutral color for ordinary (non-focus, non-confident-bridge) edges. */
export const NEUTRAL_EDGE_COLOR = 'rgba(150, 150, 160, 0.35)';
/** Warm base for the bridge glow (alpha is scaled by the bridge score). */
const BRIDGE_GLOW_RGB = '245, 166, 35';

/**
 * Color for an edge.
 *
 * Focus links are reddish. A *confident* bridge (`bridgeConfident` true and a
 * non-null `bridge` score) glows warm, with opacity scaled by the score — this
 * is the design's confidence gate: a non-confident bridge (or a null score) is
 * treated as an ordinary edge and rendered neutral, never glowing.
 */
export function edgeColor(
  edge: { bridge: number | null; bridgeConfident: boolean },
  isFocusLink: boolean,
): string {
  if (isFocusLink) return FOCUS_EDGE_COLOR;
  if (edge.bridgeConfident && edge.bridge !== null) {
    const score = Math.max(0, Math.min(1, edge.bridge));
    const alpha = 0.35 + 0.6 * score;
    return `rgba(${BRIDGE_GLOW_RGB}, ${alpha.toFixed(3)})`;
  }
  return NEUTRAL_EDGE_COLOR;
}

// ---------------------------------------------------------------------------
// Ownership -> ring
// ---------------------------------------------------------------------------

/** Gold ring stroke drawn around nodes the user already owns. */
export const OWNED_RING_COLOR = '#f5c542';

/**
 * Red highlight stroke for the current focus node — the design's "red center at
 * the focus". Drawn as an outer ring so it reads on top of any genre fill or
 * owned gold ring.
 */
export const FOCUS_NODE_COLOR = '#e0533a';

/**
 * Ring spec for an owned node (a gold outline), or `null` when the node is not
 * owned and should render without a ring.
 */
export function ownedRingStyle(owned: boolean): { stroke: string; width: number } | null {
  if (!owned) return null;
  return { stroke: OWNED_RING_COLOR, width: 2 };
}
