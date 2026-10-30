# Vibe Code Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 4 vibe-code flags to bring the project to 0 flags on the checklist.

**Architecture:** Pure presentational changes across CSS classes, icon imports, and Next.js metadata. Three-layer icon change (API data → frontend icon map → frontend constants). No runtime logic changes.

**Tech Stack:** Next.js, Tailwind CSS, Lucide React icons

**Design doc:** `docs/plans/2026-03-02-vibe-code-cleanup-design.md`

---

### Task 1: Replace purple with brand colors in AISearch.tsx

**Files:**
- Modify: `apps/web/src/app/search/components/AISearch.tsx`

**Step 1: Replace the purple banner classes**

In `AISearch.tsx`, change the AI banner div (around line 76-86):

Old:
```tsx
<div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg p-4 mb-4">
  <div className="flex items-center gap-2">
    <Sparkles className="h-5 w-5 text-purple-400" />
    <span className="text-purple-400 font-medium">AI Recommendations for:</span>
    <span className="text-zinc-300">&quot;{aiPrompt}&quot;</span>
  </div>
  {aiProviders.length > 0 && (
    <p className="text-zinc-500 text-sm mt-1">
```

New:
```tsx
<div className="bg-gradient-to-r from-secondary/10 to-primary/10 border border-secondary/20 rounded-container p-4 mb-4">
  <div className="flex items-center gap-2">
    <Sparkles className="h-5 w-5 text-secondary" />
    <span className="text-secondary font-medium">AI Recommendations for:</span>
    <span className="text-foreground">&quot;{aiPrompt}&quot;</span>
  </div>
  {aiProviders.length > 0 && (
    <p className="text-muted-foreground text-sm mt-1">
```

**Step 2: Verify no other purple references remain in this file**

Run: `grep -n "purple\|zinc" apps/web/src/app/search/components/AISearch.tsx`
Expected: No matches.

**Step 3: Commit**
```bash
git add apps/web/src/app/search/components/AISearch.tsx
git commit -m "fix(ui): replace purple with brand colors in AI search banner"
```

---

### Task 2: Replace purple with brand colors in preview/page.tsx

**Files:**
- Modify: `apps/web/src/app/preview/page.tsx`

**Step 1: Replace the AI recommendation avatar circle**

Around line 365, change:

Old:
```tsx
<div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
```

New:
```tsx
<div className="h-10 w-10 rounded-full bg-gradient-to-br from-secondary to-primary flex items-center justify-center">
```

**Step 2: Verify**

Run: `grep -n "purple\|pink-500" apps/web/src/app/preview/page.tsx`
Expected: No matches.

**Step 3: Commit**
```bash
git add apps/web/src/app/preview/page.tsx
git commit -m "fix(ui): replace purple avatar gradient with brand colors in preview"
```

---

### Task 3: Replace off-brand gradients in DashboardTiles.tsx

**Files:**
- Modify: `apps/web/src/components/feed/DashboardTiles.tsx`

**Step 1: Update all 4 StatTile color props**

Replace the 4 `<StatTile>` blocks (around lines 73-100):

Old:
```tsx
      <StatTile
        icon={<RefreshCw className="w-5 h-5 text-blue-400" />}
        value={stats.activeSubscriptions}
        label="Active Subscriptions"
        colorClass="bg-gradient-to-r from-blue-500 to-cyan-500"
        iconBgClass="bg-blue-500/10"
      />
      <StatTile
        icon={<Users className="w-5 h-5 text-pink-400" />}
        value={stats.artistsAdded}
        label="Artists Added (30d)"
        colorClass="bg-gradient-to-r from-pink-500 to-violet-500"
        iconBgClass="bg-pink-500/10"
      />
      <StatTile
        icon={<Clock className="w-5 h-5 text-cyan-400" />}
        value={stats.pendingReviews}
        label="Pending Reviews"
        colorClass="bg-gradient-to-r from-cyan-500 to-blue-500"
        iconBgClass="bg-cyan-500/10"
      />
      <StatTile
        icon={<Link2 className="w-5 h-5 text-green-400" />}
        value={stats.activeConnections}
        label="Active Connections"
        colorClass="bg-gradient-to-r from-green-500 to-cyan-500"
        iconBgClass="bg-green-500/10"
      />
```

New:
```tsx
      <StatTile
        icon={<RefreshCw className="w-5 h-5 text-primary" />}
        value={stats.activeSubscriptions}
        label="Active Subscriptions"
        colorClass="bg-primary"
        iconBgClass="bg-primary/10"
      />
      <StatTile
        icon={<Users className="w-5 h-5 text-secondary" />}
        value={stats.artistsAdded}
        label="Artists Added (30d)"
        colorClass="bg-secondary"
        iconBgClass="bg-secondary/10"
      />
      <StatTile
        icon={<Clock className="w-5 h-5 text-status-warning" />}
        value={stats.pendingReviews}
        label="Pending Reviews"
        colorClass="bg-[hsl(var(--warning))]"
        iconBgClass="bg-[hsl(var(--warning))]/10"
      />
      <StatTile
        icon={<Link2 className="w-5 h-5 text-status-success" />}
        value={stats.activeConnections}
        label="Active Connections"
        colorClass="bg-[hsl(var(--success))]"
        iconBgClass="bg-[hsl(var(--success))]/10"
      />
```

**Step 2: Verify**

Run: `grep -n "blue-\|pink-\|cyan-\|violet-\|green-" apps/web/src/components/feed/DashboardTiles.tsx`
Expected: No matches.

**Step 3: Commit**
```bash
git add apps/web/src/components/feed/DashboardTiles.tsx
git commit -m "fix(ui): replace neon gradients with brand palette in dashboard tiles"
```

---

### Task 4: Diversify Sparkles icon — API layer

**Files:**
- Modify: `apps/api/src/data/subscription-types.ts`

**Step 1: Change icon strings for non-AI subscription types**

Change these 6 lines:
- `lastfm_similar`: `icon: 'Sparkles'` → `icon: 'GitFork'`
- `deezer_flow`: `icon: 'Sparkles'` → `icon: 'Radio'`
- `tidal_discovery`: `icon: 'Sparkles'` → `icon: 'Compass'`
- `tidal_mix`: `icon: 'Sparkles'` → `icon: 'Shuffle'`
- `tautulli_similar`: `icon: 'Sparkles'` → `icon: 'GitFork'`
- `jellyfin_similar`: `icon: 'Sparkles'` → `icon: 'GitFork'`

**Step 2: Verify no Sparkles references remain**

Run: `grep -n "Sparkles" apps/api/src/data/subscription-types.ts`
Expected: No matches.

**Step 3: Commit**
```bash
git add apps/api/src/data/subscription-types.ts
git commit -m "fix(api): diversify subscription type icons away from Sparkles"
```

---

### Task 5: Diversify Sparkles icon — Frontend icon resolver

**Files:**
- Modify: `apps/web/src/lib/use-subscription-types.ts`

**Step 1: Add new icon imports**

Add after the existing lucide imports (around line 15):
```typescript
import GitFork from 'lucide-react/dist/esm/icons/git-fork';
import Radio from 'lucide-react/dist/esm/icons/radio';
import Compass from 'lucide-react/dist/esm/icons/compass';
import Shuffle from 'lucide-react/dist/esm/icons/shuffle';
```

Remove the Sparkles import:
```typescript
// DELETE: import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
```

**Step 2: Update the ICON_MAP**

In the `ICON_MAP` object (around line 56-65), add the new icons and remove Sparkles:

Old:
```typescript
const ICON_MAP: Record<string, LucideIcon> = {
  Brain,
  Disc,
  Globe,
  Headphones,
  Music2,
  ShoppingBag,
  Sparkles,
  Tag,
  TrendingUp,
};
```

New:
```typescript
const ICON_MAP: Record<string, LucideIcon> = {
  Brain,
  Compass,
  Disc,
  GitFork,
  Globe,
  Headphones,
  Music2,
  Radio,
  ShoppingBag,
  Shuffle,
  Tag,
  TrendingUp,
};
```

**Step 3: Verify**

Run: `grep -n "Sparkles" apps/web/src/lib/use-subscription-types.ts`
Expected: No matches.

**Step 4: Commit**
```bash
git add apps/web/src/lib/use-subscription-types.ts
git commit -m "fix(ui): update icon map with diversified subscription icons"
```

---

### Task 6: Diversify Sparkles icon — Frontend constants

**Files:**
- Modify: `apps/web/src/lib/subscription-constants.ts`

**Step 1: Replace Sparkles import with new icons**

Remove the Sparkles import line and add:
```typescript
import Compass from 'lucide-react/dist/esm/icons/compass';
import GitFork from 'lucide-react/dist/esm/icons/git-fork';
import Radio from 'lucide-react/dist/esm/icons/radio';
import Shuffle from 'lucide-react/dist/esm/icons/shuffle';
```

**Step 2: Update the subscription type entries**

Change icon references for these entries:
- `lastfm_similar`: `icon: Sparkles` → `icon: GitFork`
- `deezer_flow`: `icon: Sparkles` → `icon: Radio`
- `tidal_discovery`: `icon: Sparkles` → `icon: Compass`
- `tidal_mix`: `icon: Sparkles` → `icon: Shuffle`
- `tautulli_similar`: `icon: Sparkles` → `icon: GitFork`
- `jellyfin_similar`: `icon: Sparkles` → `icon: GitFork`

Also check `metadataSources` array — if `musicbrainz` entry uses Sparkles, change to `Database`. (Design investigation showed it already uses `Music2`, so likely no change needed — verify.)

**Step 3: Verify**

Run: `grep -n "Sparkles" apps/web/src/lib/subscription-constants.ts`
Expected: No matches.

**Step 4: Commit**
```bash
git add apps/web/src/lib/subscription-constants.ts
git commit -m "fix(ui): use semantically appropriate icons for subscription types"
```

---

### Task 7: Add OpenGraph metadata

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Create: `apps/web/public/og-image.png`

**Step 1: Create OG image**

Generate a 1200×630 PNG using a script or canvas. The image should have:
- Background: `#1c1b19` (brand dark)
- "Mixarr" text centered in cream (`#ebe7df`)
- A copper (`#bf7a56`) accent line below the text
- Subtitle: "Music discovery and import tool for Lidarr" in muted cream

Use a Node.js canvas script to generate it, or create a minimal SVG and convert.

**Step 2: Add openGraph and twitter to metadata**

In `layout.tsx`, add to the `metadata` export (after the `icons` property):

```typescript
  openGraph: {
    title: 'Mixarr',
    description: 'Music discovery and import tool for Lidarr',
    siteName: 'Mixarr',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Mixarr - Music discovery and import tool for Lidarr',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mixarr',
    description: 'Music discovery and import tool for Lidarr',
    images: ['/og-image.png'],
  },
```

**Step 3: Verify the metadata renders**

Run the dev server and check `view-source:` for `og:image`, `og:title`, `twitter:card` meta tags.

**Step 4: Commit**
```bash
git add apps/web/public/og-image.png apps/web/src/app/layout.tsx
git commit -m "feat(seo): add OpenGraph and Twitter card metadata"
```

---

### Task 8: Add rounded-container token to Tailwind config

**Files:**
- Modify: `apps/web/tailwind.config.ts`

**Step 1: Add the container radius token**

In the `borderRadius` extend section (around line 117):

Old:
```typescript
      borderRadius: {
        'card': '1.25rem',    // 20px - generous card rounding
        'button': '0.625rem', // 10px - pill-ish buttons
      },
```

New:
```typescript
      borderRadius: {
        'card': '1.25rem',       // 20px - generous card rounding
        'container': '0.75rem',  // 12px - list items, inner containers, banners
        'button': '0.625rem',    // 10px - pill-ish buttons
      },
```

**Step 2: Commit**
```bash
git add apps/web/tailwind.config.ts
git commit -m "feat(ui): add rounded-container token to design system"
```

---

### Task 9: Migrate rounded-lg to rounded-container in page-level list items

**Files (list items and container patterns only — NOT sidebar nav, icons, or small elements):**
- Modify: `apps/web/src/app/jobs/page.tsx` (skeleton + job rows)
- Modify: `apps/web/src/app/search/page.tsx` (skeleton rows)
- Modify: `apps/web/src/app/subscriptions/page.tsx` (skeleton rows)
- Modify: `apps/web/src/app/downloads/page.tsx` (skeleton rows)
- Modify: `apps/web/src/app/users/page.tsx` (user rows)
- Modify: `apps/web/src/app/settings/notifications/page.tsx` (channel rows)
- Modify: `apps/web/src/app/connections/page.tsx` (skeleton cards)
- Modify: `apps/web/src/app/settings/page.tsx` (skeleton cards)
- Modify: `apps/web/src/components/settings/ai-settings.tsx` (setting sections)
- Modify: `apps/web/src/components/settings/sso-settings.tsx` (provider sections)

**Step 1: Replace `rounded-lg` with `rounded-container` in list item and container patterns**

Target only elements that are list item rows, skeleton containers, bordered sections, or alert/info banners. Do NOT change:
- Sidebar nav items (8px is correct for tight nav)
- Mobile nav items (8px is correct for compact touch targets)
- Small icon containers (8px is correct for small elements)
- Login page elements (standalone page with its own visual context)

This is a bulk find-and-replace scoped to the files listed above.

**Step 2: Verify the build compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors (CSS class changes don't affect TypeScript).

**Step 3: Commit**
```bash
git add apps/web/src/
git commit -m "fix(ui): migrate list items and containers to rounded-container token"
```

---

### Task 10: Final verification

**Step 1: Re-run the vibe code flag audit**

Run these grep checks to confirm all flags are resolved:
```bash
# No purple references in UI (except themes.ts which is theme preview swatches)
grep -rn "purple\|violet" apps/web/src/ --include="*.tsx" | grep -v themes.ts | grep -v node_modules

# Sparkles only in AI-related files
grep -rn "Sparkles" apps/web/src/ --include="*.tsx" --include="*.ts"

# OG image exists
ls -la apps/web/public/og-image.png

# rounded-container token exists
grep "container" apps/web/tailwind.config.ts
```

**Step 2: Commit the design doc**
```bash
git add docs/plans/
git commit -m "docs: add vibe code cleanup design and plan"
```

---

## Plan Review Gate

- ✅ **Wiring completeness** — Every UI color/icon reference traces to a theme token or specific icon component
- ✅ **Resource lifecycle** — N/A (no runtime resources created)
- ✅ **Dependency completeness** — All Lucide icons are already available in the package, no new installs needed
- ✅ **Config consistency** — Tailwind config tokens match CSS usage
- ✅ **Async/sync boundaries** — N/A (no runtime logic changes)
- ✅ **Missing integration steps** — Three-layer icon change covers API → icon map → constants; all wired

**Plan review passed.**
