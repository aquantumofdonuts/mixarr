# Theme Picker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 6 distinct visual themes with a radial popup theme picker in the sidebar footer.

**Architecture:** Extend existing next-themes setup with custom theme names. Each theme defined as CSS custom properties in separate files. ThemePicker component displays radial popup with mini-previews. Theme persisted to localStorage.

**Tech Stack:** Next.js, next-themes, Tailwind CSS, CSS custom properties, Lucide icons

---

## Task 1: Create Theme CSS Files

**Files:**
- Create: `apps/web/src/styles/themes/dark-luxe.css`
- Create: `apps/web/src/styles/themes/editorial-clean.css`
- Create: `apps/web/src/styles/themes/neo-brutalist.css`
- Create: `apps/web/src/styles/themes/soft-gradient.css`
- Create: `apps/web/src/styles/themes/vinyl-retro.css`
- Create: `apps/web/src/styles/themes/midnight-modern.css`
- Create: `apps/web/src/styles/themes/index.css`

**Step 1: Create dark-luxe.css**

```css
/* Dark Luxe Theme - Sophisticated dark with gold accents */
[data-theme="dark-luxe"] {
  /* Backgrounds */
  --background: 0 0% 5%;
  --foreground: 40 20% 95%;
  --card: 0 0% 8%;
  --card-foreground: 40 20% 95%;
  --popover: 0 0% 8%;
  --popover-foreground: 40 20% 95%;
  
  /* Brand colors */
  --primary: 45 80% 45%;
  --primary-foreground: 0 0% 5%;
  --secondary: 0 0% 12%;
  --secondary-foreground: 40 20% 90%;
  
  /* UI colors */
  --muted: 0 0% 15%;
  --muted-foreground: 40 10% 60%;
  --accent: 45 60% 25%;
  --accent-foreground: 45 80% 80%;
  --destructive: 0 70% 50%;
  --destructive-foreground: 0 0% 100%;
  
  /* Borders & inputs */
  --border: 0 0% 18%;
  --input: 0 0% 15%;
  --ring: 45 80% 45%;
  
  /* Sidebar */
  --sidebar: 0 0% 4%;
  --sidebar-foreground: 40 15% 85%;
  --sidebar-border: 45 30% 15%;
  
  /* Radius */
  --radius: 0.5rem;
}

[data-theme="dark-luxe"] body {
  font-family: 'Source Sans 3', -apple-system, sans-serif;
}

[data-theme="dark-luxe"] h1,
[data-theme="dark-luxe"] h2,
[data-theme="dark-luxe"] h3,
[data-theme="dark-luxe"] h4 {
  font-family: 'Playfair Display', Georgia, serif;
  font-weight: 500;
  letter-spacing: -0.02em;
}
```

**Step 2: Create editorial-clean.css**

```css
/* Editorial Clean Theme - Minimal black & white with red accent */
[data-theme="editorial-clean"] {
  /* Backgrounds */
  --background: 0 0% 98%;
  --foreground: 0 0% 8%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 8%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 8%;
  
  /* Brand colors */
  --primary: 0 0% 8%;
  --primary-foreground: 0 0% 100%;
  --secondary: 0 0% 95%;
  --secondary-foreground: 0 0% 20%;
  
  /* UI colors */
  --muted: 0 0% 92%;
  --muted-foreground: 0 0% 45%;
  --accent: 0 85% 55%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 70% 50%;
  --destructive-foreground: 0 0% 100%;
  
  /* Borders & inputs */
  --border: 0 0% 88%;
  --input: 0 0% 92%;
  --ring: 0 0% 8%;
  
  /* Sidebar */
  --sidebar: 0 0% 100%;
  --sidebar-foreground: 0 0% 8%;
  --sidebar-border: 0 0% 90%;
  
  --radius: 0rem;
}

[data-theme="editorial-clean"] body {
  font-family: 'IBM Plex Sans', -apple-system, sans-serif;
}

[data-theme="editorial-clean"] h1,
[data-theme="editorial-clean"] h2,
[data-theme="editorial-clean"] h3,
[data-theme="editorial-clean"] h4 {
  font-family: 'IBM Plex Serif', Georgia, serif;
  font-weight: 600;
  letter-spacing: -0.01em;
}
```

**Step 3: Create neo-brutalist.css**

```css
/* Neo-Brutalist Theme - Bold, raw, high contrast */
[data-theme="neo-brutalist"] {
  /* Backgrounds */
  --background: 60 100% 97%;
  --foreground: 0 0% 0%;
  --card: 60 100% 97%;
  --card-foreground: 0 0% 0%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 0%;
  
  /* Brand colors */
  --primary: 0 0% 0%;
  --primary-foreground: 60 100% 97%;
  --secondary: 0 0% 100%;
  --secondary-foreground: 0 0% 0%;
  
  /* UI colors */
  --muted: 60 30% 90%;
  --muted-foreground: 0 0% 40%;
  --accent: 330 100% 50%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 100% 50%;
  --destructive-foreground: 0 0% 100%;
  
  /* Borders & inputs */
  --border: 0 0% 0%;
  --input: 0 0% 100%;
  --ring: 0 0% 0%;
  
  /* Sidebar */
  --sidebar: 0 0% 0%;
  --sidebar-foreground: 60 100% 97%;
  --sidebar-border: 0 0% 20%;
  
  --radius: 0rem;
}

[data-theme="neo-brutalist"] body {
  font-family: 'Space Mono', monospace;
}

[data-theme="neo-brutalist"] h1,
[data-theme="neo-brutalist"] h2,
[data-theme="neo-brutalist"] h3,
[data-theme="neo-brutalist"] h4 {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.03em;
}
```

**Step 4: Create soft-gradient.css**

```css
/* Soft Gradient Theme - Gentle gradients, soft pastels */
[data-theme="soft-gradient"] {
  /* Backgrounds */
  --background: 270 50% 98%;
  --foreground: 270 30% 20%;
  --card: 0 0% 100%;
  --card-foreground: 270 30% 20%;
  --popover: 0 0% 100%;
  --popover-foreground: 270 30% 20%;
  
  /* Brand colors */
  --primary: 270 70% 60%;
  --primary-foreground: 0 0% 100%;
  --secondary: 200 60% 94%;
  --secondary-foreground: 270 30% 30%;
  
  /* UI colors */
  --muted: 270 30% 94%;
  --muted-foreground: 270 15% 50%;
  --accent: 330 70% 65%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 70% 55%;
  --destructive-foreground: 0 0% 100%;
  
  /* Borders & inputs */
  --border: 270 30% 88%;
  --input: 270 30% 95%;
  --ring: 270 70% 60%;
  
  /* Sidebar */
  --sidebar: 270 40% 96%;
  --sidebar-foreground: 270 30% 25%;
  --sidebar-border: 270 30% 90%;
  
  --radius: 1rem;
}

[data-theme="soft-gradient"] body {
  font-family: 'DM Sans', -apple-system, sans-serif;
}

[data-theme="soft-gradient"] h1,
[data-theme="soft-gradient"] h2,
[data-theme="soft-gradient"] h3,
[data-theme="soft-gradient"] h4 {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-weight: 600;
}
```

**Step 5: Create vinyl-retro.css**

```css
/* Vinyl Retro Theme - Warm vintage, record store vibes */
[data-theme="vinyl-retro"] {
  /* Backgrounds */
  --background: 35 30% 12%;
  --foreground: 35 30% 90%;
  --card: 35 25% 15%;
  --card-foreground: 35 30% 90%;
  --popover: 35 25% 15%;
  --popover-foreground: 35 30% 90%;
  
  /* Brand colors */
  --primary: 25 90% 55%;
  --primary-foreground: 35 30% 10%;
  --secondary: 35 20% 20%;
  --secondary-foreground: 35 30% 85%;
  
  /* UI colors */
  --muted: 35 15% 22%;
  --muted-foreground: 35 20% 55%;
  --accent: 25 90% 55%;
  --accent-foreground: 35 30% 10%;
  --destructive: 0 70% 50%;
  --destructive-foreground: 0 0% 100%;
  
  /* Borders & inputs */
  --border: 35 15% 25%;
  --input: 35 15% 18%;
  --ring: 25 90% 55%;
  
  /* Sidebar */
  --sidebar: 35 25% 8%;
  --sidebar-foreground: 35 30% 85%;
  --sidebar-border: 35 20% 18%;
  
  --radius: 0.375rem;
}

[data-theme="vinyl-retro"] body {
  font-family: 'Instrument Sans', -apple-system, sans-serif;
}

[data-theme="vinyl-retro"] h1,
[data-theme="vinyl-retro"] h2,
[data-theme="vinyl-retro"] h3,
[data-theme="vinyl-retro"] h4 {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
}
```

**Step 6: Create midnight-modern.css**

```css
/* Midnight Modern Theme - Clean dark with vibrant accents */
[data-theme="midnight-modern"] {
  /* Backgrounds */
  --background: 225 25% 8%;
  --foreground: 210 40% 96%;
  --card: 225 25% 11%;
  --card-foreground: 210 40% 96%;
  --popover: 225 25% 11%;
  --popover-foreground: 210 40% 96%;
  
  /* Brand colors */
  --primary: 145 70% 50%;
  --primary-foreground: 225 25% 8%;
  --secondary: 225 20% 16%;
  --secondary-foreground: 210 40% 92%;
  
  /* UI colors */
  --muted: 225 20% 18%;
  --muted-foreground: 210 20% 55%;
  --accent: 270 70% 60%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 70% 50%;
  --destructive-foreground: 0 0% 100%;
  
  /* Borders & inputs */
  --border: 225 20% 18%;
  --input: 225 20% 14%;
  --ring: 145 70% 50%;
  
  /* Sidebar */
  --sidebar: 225 25% 6%;
  --sidebar-foreground: 210 30% 90%;
  --sidebar-border: 225 20% 15%;
  
  --radius: 0.75rem;
}

[data-theme="midnight-modern"] body {
  font-family: 'Inter', -apple-system, sans-serif;
}

[data-theme="midnight-modern"] h1,
[data-theme="midnight-modern"] h2,
[data-theme="midnight-modern"] h3,
[data-theme="midnight-modern"] h4 {
  font-family: 'Inter', -apple-system, sans-serif;
  font-weight: 600;
  letter-spacing: -0.02em;
}
```

**Step 7: Create index.css**

```css
/* Theme imports */
@import './dark-luxe.css';
@import './editorial-clean.css';
@import './neo-brutalist.css';
@import './soft-gradient.css';
@import './vinyl-retro.css';
@import './midnight-modern.css';
```

**Step 8: Commit**

```bash
git add apps/web/src/styles/themes/
git commit -m "feat(web): add 6 theme CSS files with custom properties"
```

---

## Task 2: Update Theme Provider Configuration

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css`

**Step 1: Update globals.css to import themes**

At the top of globals.css after tailwind imports, add:

```css
@import '../styles/themes/index.css';
```

And set default theme (dark-luxe) as the base dark mode:

```css
/* In the .dark section, these become fallback - themes override */
```

**Step 2: Update layout.tsx ThemeProvider**

Change ThemeProvider configuration:

```tsx
<ThemeProvider
  attribute="data-theme"
  defaultTheme="dark-luxe"
  themes={['dark-luxe', 'editorial-clean', 'neo-brutalist', 'soft-gradient', 'vinyl-retro', 'midnight-modern']}
  enableSystem={false}
  disableTransitionOnChange={false}
>
```

**Step 3: Commit**

```bash
git add apps/web/src/app/layout.tsx apps/web/src/app/globals.css
git commit -m "feat(web): configure theme provider for 6 custom themes"
```

---

## Task 3: Create Theme Metadata

**Files:**
- Create: `apps/web/src/lib/themes.ts`

**Step 1: Create themes.ts with metadata**

```typescript
export interface ThemeConfig {
  id: string;
  name: string;
  description: string;
  colors: {
    primary: string;
    accent: string;
    background: string;
  };
}

export const themes: ThemeConfig[] = [
  {
    id: 'dark-luxe',
    name: 'Dark Luxe',
    description: 'Sophisticated dark with gold accents',
    colors: {
      primary: '#C9A227',
      accent: '#C9A227',
      background: '#0D0D0D',
    },
  },
  {
    id: 'editorial-clean',
    name: 'Editorial',
    description: 'Minimal black & white with red accent',
    colors: {
      primary: '#1A1A1A',
      accent: '#E53935',
      background: '#FAFAFA',
    },
  },
  {
    id: 'neo-brutalist',
    name: 'Neo-Brutalist',
    description: 'Bold, raw, high contrast',
    colors: {
      primary: '#000000',
      accent: '#FF0080',
      background: '#FFFEF0',
    },
  },
  {
    id: 'soft-gradient',
    name: 'Soft Gradient',
    description: 'Gentle gradients, soft pastels',
    colors: {
      primary: '#8B5CF6',
      accent: '#EC4899',
      background: '#FAF5FF',
    },
  },
  {
    id: 'vinyl-retro',
    name: 'Vinyl Retro',
    description: 'Warm vintage, record store vibes',
    colors: {
      primary: '#F97316',
      accent: '#F97316',
      background: '#1C1917',
    },
  },
  {
    id: 'midnight-modern',
    name: 'Midnight Modern',
    description: 'Clean dark with vibrant accents',
    colors: {
      primary: '#22C55E',
      accent: '#A855F7',
      background: '#0F172A',
    },
  },
];

export const DEFAULT_THEME = 'dark-luxe';
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/themes.ts
git commit -m "feat(web): add theme metadata configuration"
```

---

## Task 4: Create ThemePicker Component

**Files:**
- Create: `apps/web/src/components/ui/theme-picker.tsx`

**Step 1: Create the radial theme picker**

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { Palette, Check } from 'lucide-react';
import { themes, ThemeConfig } from '@/lib/themes';
import { cn } from '@/lib/utils';

export function ThemePicker() {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  if (!mounted) {
    return (
      <button className="rounded-lg p-2 hover:bg-accent transition-colors" disabled>
        <Palette className="h-5 w-5" />
      </button>
    );
  }

  const handleThemeSelect = (themeId: string) => {
    setTheme(themeId);
    setIsOpen(false);
  };

  // Calculate positions for radial layout (semi-circle fanning up-right)
  const getPosition = (index: number, total: number) => {
    // Start at 180° (left), end at 0° (right), fanning upward
    const startAngle = 200; // degrees
    const endAngle = 340; // degrees
    const angleStep = (endAngle - startAngle) / (total - 1);
    const angle = startAngle + index * angleStep;
    const radians = (angle * Math.PI) / 180;
    const radius = 90; // distance from center

    return {
      x: Math.cos(radians) * radius,
      y: Math.sin(radians) * radius,
    };
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'rounded-lg p-2 transition-all duration-200',
          'hover:bg-accent hover:text-accent-foreground',
          isOpen && 'bg-accent text-accent-foreground'
        )}
        aria-label="Choose theme"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Palette className="h-5 w-5" />
      </button>

      {/* Radial popup */}
      {isOpen && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2"
          style={{ width: '200px', height: '120px' }}
          role="menu"
          aria-label="Theme options"
        >
          {themes.map((t, index) => {
            const pos = getPosition(index, themes.length);
            const isActive = theme === t.id;
            
            return (
              <button
                key={t.id}
                onClick={() => handleThemeSelect(t.id)}
                className={cn(
                  'absolute w-12 h-12 rounded-full transition-all duration-300',
                  'flex items-center justify-center',
                  'hover:scale-110 hover:z-10',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  isActive && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                )}
                style={{
                  left: `calc(50% + ${pos.x}px - 24px)`,
                  top: `calc(100% + ${pos.y}px - 24px)`,
                  transitionDelay: `${index * 30}ms`,
                  animationDelay: `${index * 30}ms`,
                }}
                title={t.name}
                role="menuitem"
                aria-label={`${t.name}: ${t.description}`}
              >
                <ThemePreview theme={t} isActive={isActive} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThemePreview({ theme, isActive }: { theme: ThemeConfig; isActive: boolean }) {
  return (
    <div
      className="w-full h-full rounded-full overflow-hidden border-2 border-border shadow-lg relative"
      style={{ background: theme.colors.background }}
    >
      {/* Top half - background color */}
      <div
        className="absolute top-0 left-0 right-0 h-1/2"
        style={{ background: theme.colors.background }}
      />
      {/* Bottom half - accent color */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1/2"
        style={{ background: theme.colors.accent }}
      />
      {/* Center dot - primary color */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border border-white/20"
        style={{ background: theme.colors.primary }}
      />
      {/* Active indicator */}
      {isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-full">
          <Check className="h-5 w-5 text-white drop-shadow-md" />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ui/theme-picker.tsx
git commit -m "feat(web): create radial ThemePicker component"
```

---

## Task 5: Add ThemePicker to Sidebar

**Files:**
- Modify: `apps/web/src/components/layout/sidebar.tsx`

**Step 1: Import ThemePicker**

Add to imports:

```tsx
import { ThemePicker } from '@/components/ui/theme-picker';
```

**Step 2: Replace theme toggle with ThemePicker**

Replace the existing theme toggle button in the header section:

```tsx
{/* Theme toggle */}
<button
  onClick={toggleTheme}
  className="rounded-lg p-2 hover:bg-accent transition-colors"
  title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
>
  {theme === 'dark' ? (
    <Sun className="h-4 w-4" />
  ) : (
    <Moon className="h-4 w-4" />
  )}
</button>
```

With:

```tsx
{/* Theme picker */}
<ThemePicker />
```

**Step 3: Remove unused imports**

Remove `Sun`, `Moon` from lucide imports since they're no longer used. Also remove `toggleTheme` function.

**Step 4: Commit**

```bash
git add apps/web/src/components/layout/sidebar.tsx
git commit -m "feat(web): integrate ThemePicker into sidebar"
```

---

## Task 6: Add Google Fonts

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

**Step 1: Add font imports**

Add additional font imports for theme-specific fonts:

```tsx
import { Inter, Playfair_Display, IBM_Plex_Sans, IBM_Plex_Serif, Space_Mono, Space_Grotesk, DM_Sans, Outfit } from 'next/font/google';

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
});

const ibmPlexSans = IBM_Plex_Sans({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-ibm-plex-sans',
});

const ibmPlexSerif = IBM_Plex_Serif({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-ibm-plex-serif',
});

const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-space-mono',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
});
```

**Step 2: Apply font variables to body**

```tsx
<body className={`${inter.variable} ${playfair.variable} ${ibmPlexSans.variable} ${ibmPlexSerif.variable} ${spaceMono.variable} ${spaceGrotesk.variable} ${dmSans.variable} ${outfit.variable} font-sans`}>
```

**Step 3: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat(web): add Google Fonts for all themes"
```

---

## Task 7: Update Theme CSS to Use Font Variables

**Files:**
- Modify: `apps/web/src/styles/themes/dark-luxe.css`
- Modify: `apps/web/src/styles/themes/editorial-clean.css`
- Modify: `apps/web/src/styles/themes/neo-brutalist.css`
- Modify: `apps/web/src/styles/themes/soft-gradient.css`
- Modify: `apps/web/src/styles/themes/vinyl-retro.css`
- Modify: `apps/web/src/styles/themes/midnight-modern.css`

**Step 1: Update all theme files to use CSS font variables**

Update font-family declarations to use the CSS variables set by Next.js fonts:

For dark-luxe.css:
```css
[data-theme="dark-luxe"] body {
  font-family: var(--font-inter), -apple-system, sans-serif;
}

[data-theme="dark-luxe"] h1,
[data-theme="dark-luxe"] h2,
[data-theme="dark-luxe"] h3,
[data-theme="dark-luxe"] h4 {
  font-family: var(--font-playfair), Georgia, serif;
}
```

Similarly for other themes using their respective font variables.

**Step 2: Commit**

```bash
git add apps/web/src/styles/themes/
git commit -m "feat(web): update theme fonts to use CSS variables"
```

---

## Task 8: Write Tests

**Files:**
- Create: `apps/web/src/components/ui/__tests__/theme-picker.test.tsx`

**Step 1: Create test file**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { ThemePicker } from '../theme-picker';
import { themes } from '@/lib/themes';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next-themes
vi.mock('next-themes', async () => {
  const actual = await vi.importActual('next-themes');
  return {
    ...actual,
    useTheme: () => ({
      theme: 'dark-luxe',
      setTheme: vi.fn(),
    }),
  };
});

describe('ThemePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders trigger button', () => {
    render(<ThemePicker />);
    expect(screen.getByRole('button', { name: /choose theme/i })).toBeInTheDocument();
  });

  it('opens radial menu on click', () => {
    render(<ThemePicker />);
    const trigger = screen.getByRole('button', { name: /choose theme/i });
    
    fireEvent.click(trigger);
    
    expect(screen.getByRole('menu', { name: /theme options/i })).toBeInTheDocument();
  });

  it('displays all theme options', () => {
    render(<ThemePicker />);
    const trigger = screen.getByRole('button', { name: /choose theme/i });
    
    fireEvent.click(trigger);
    
    themes.forEach((theme) => {
      expect(screen.getByRole('menuitem', { name: new RegExp(theme.name, 'i') })).toBeInTheDocument();
    });
  });

  it('closes on escape key', () => {
    render(<ThemePicker />);
    const trigger = screen.getByRole('button', { name: /choose theme/i });
    
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows active indicator for current theme', () => {
    render(<ThemePicker />);
    const trigger = screen.getByRole('button', { name: /choose theme/i });
    
    fireEvent.click(trigger);
    
    const activeTheme = screen.getByRole('menuitem', { name: /dark luxe/i });
    expect(activeTheme).toHaveClass('ring-2');
  });
});
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ui/__tests__/
git commit -m "test(web): add ThemePicker component tests"
```

---

## Task 9: Test All Themes Manually

**Step 1: Start the dev server**

```bash
cd apps/web && npm run dev
```

**Step 2: Verify each theme**

Open browser, click theme picker, verify:
- [ ] Dark Luxe - Gold accents, serif headings
- [ ] Editorial Clean - B&W, red accent, sharp corners
- [ ] Neo-Brutalist - Yellow background, black borders, uppercase headings
- [ ] Soft Gradient - Purple/pink pastels, rounded corners
- [ ] Vinyl Retro - Warm browns/oranges, vintage feel
- [ ] Midnight Modern - Dark blue, green/purple accents

**Step 3: Verify persistence**

- Select a theme
- Refresh page
- Theme should persist

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(web): complete theme picker implementation with 6 themes"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create 6 theme CSS files | 7 new files in `styles/themes/` |
| 2 | Update ThemeProvider config | `layout.tsx`, `globals.css` |
| 3 | Create theme metadata | `lib/themes.ts` |
| 4 | Create ThemePicker component | `components/ui/theme-picker.tsx` |
| 5 | Add to sidebar | `components/layout/sidebar.tsx` |
| 6 | Add Google Fonts | `layout.tsx` |
| 7 | Update theme fonts | 6 theme CSS files |
| 8 | Write tests | `__tests__/theme-picker.test.tsx` |
| 9 | Manual testing | All themes verified |
