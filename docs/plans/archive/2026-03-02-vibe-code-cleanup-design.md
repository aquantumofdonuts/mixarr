# Vibe Code Cleanup — Design Document

**Date:** 2026-03-02  
**Status:** Approved (design attack passed)

## Problem

The Vibe Code Flag skill audit found 4 minor flags (threshold is 5+, so the project is clean overall, but we want 0):

1. **Off-brand purple** — 3 files use hard-coded purple/pink Tailwind colors instead of the Listening Room copper/teal theme tokens
2. **Sparkles icon overuse** — Sparkles used for ~7 subscription types that aren't AI-powered, plus correctly used for 3 genuinely AI features
3. **Missing OpenGraph metadata** — No `og:image`, `og:title`, `og:description` in layout.tsx, so link previews on Discord/Slack are blank
4. **Border radius inconsistency** — Design system has `rounded-card` (20px) and `rounded-button` (10px) but `rounded-lg` (8px) used ad-hoc for containers/list items

## Design Decisions

### 1. Purple → Brand Palette

| File | Old | New |
|------|-----|-----|
| `AISearch.tsx` banner bg | `from-purple-500/10 to-pink-500/10` | `from-secondary/10 to-primary/10` |
| `AISearch.tsx` banner border | `border-purple-500/20` | `border-secondary/20` |
| `AISearch.tsx` icon + label color | `text-purple-400` | `text-secondary` |
| `AISearch.tsx` prompt text | `text-zinc-300` | `text-foreground` |
| `AISearch.tsx` powered-by text | `text-zinc-500` | `text-muted-foreground` |
| `preview/page.tsx` AI avatar circle | `from-purple-500 to-pink-500` | `from-secondary to-primary` |
| `DashboardTiles.tsx` tile accents | neon blue/pink/violet/green gradients | copper/teal/amber/green from brand tokens |

**DashboardTiles mapping:**
- Active Subscriptions: `bg-primary` accent + `text-primary` icon + `bg-primary/10` icon bg
- Artists Added (30d): `bg-secondary` accent + `text-secondary` icon + `bg-secondary/10` icon bg
- Pending Reviews: `bg-[hsl(var(--warning))]` accent + `text-status-warning` icon + `bg-[hsl(var(--warning))]/10` icon bg
- Active Connections: `bg-[hsl(var(--success))]` accent + `text-status-success` icon + `bg-[hsl(var(--success))]/10` icon bg

### 2. Icon Diversification (three-layer change)

**API layer** (`apps/api/src/data/subscription-types.ts`):
| Type | Old icon string | New icon string |
|------|----------------|-----------------|
| `lastfm_similar` | `Sparkles` | `GitFork` |
| `tautulli_similar` | `Sparkles` | `GitFork` |
| `jellyfin_similar` | `Sparkles` | `GitFork` |
| `deezer_flow` | `Sparkles` | `Radio` |
| `tidal_discovery` | `Sparkles` | `Compass` |
| `tidal_mix` | `Sparkles` | `Shuffle` |

**Frontend icon resolver** (`use-subscription-types.ts` ICON_MAP):
- Add: `GitFork`, `Radio`, `Compass`, `Shuffle`
- Remove: `Sparkles` (no longer sent by API)

**Frontend static constants** (`subscription-constants.ts`):
- Same icon component swaps as API layer
- Remove Sparkles import, add GitFork/Radio/Compass/Shuffle imports

**Keep Sparkles in:**
- `AISearch.tsx` — AI recommendations banner
- `preview/page.tsx` — AI recommendations section  
- `discover/page.tsx` — AI suggestion features

### 3. OpenGraph Metadata

Add to `layout.tsx` metadata export:
- `openGraph: { title, description, siteName, type: 'website', images }`
- `twitter: { card: 'summary_large_image', title, description, images }`
- Create `/public/og-image.png` (1200×630, Mixarr wordmark on dark brand background with copper accent)

### 4. Border Radius Token

Add `'container': '0.75rem'` (12px) to tailwind.config.ts `borderRadius`.

Migrate `rounded-lg` → `rounded-container` on list items and inner containers across pages.

**Keep as-is:** `rounded-full` (avatars/badges), `rounded-md` (skeleton shapes, small inline elements).

## Design Attack Results

- ✅ Three-layer icon change identified (API → icon map → constants) — all layers covered
- ✅ Light mode contrast for `text-secondary` passes WCAG AA (4.8:1)
- ✅ No async/state/lifecycle concerns — all changes are presentational
- ✅ No new dependencies — all Lucide icons already available
- ✅ Config consistent (Tailwind tokens ↔ CSS usage)

**Design attack passed — no architectural contradictions found.**
