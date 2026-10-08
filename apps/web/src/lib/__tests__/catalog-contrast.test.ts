// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../../../tailwind.config';

const css = readFileSync(new URL('../../styles/themes/catalog.css', import.meta.url), 'utf8');

function rgb(color: string): number[] {
  if (color.startsWith('#')) {
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error(`Invalid hex color: ${color}`);
    return [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255);
  }
  const match = color.match(/^([\d.]+) ([\d.]+)% ([\d.]+)%$/);
  if (!match) throw new Error(`Invalid HSL color: ${color}`);
  const h = Number(match[1]) / 360, s = Number(match[2]) / 100, l = Number(match[3]) / 100;
  const channel = (offset: number) => {
    const k = (offset + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function luminance(color: string): number {
  const channels = rgb(color).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function tokens(theme: 'light' | 'dark'): Record<string, string> {
  const block = css.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))?.[1];
  if (!block) throw new Error(`Missing ${theme} theme`);
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]]));
}

const textPairs = [
  ['foreground', 'background'], ['card-foreground', 'card'], ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'], ['primary-foreground', 'primary-hover'],
  ['secondary-foreground', 'secondary'], ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'], ['sidebar-foreground', 'sidebar'],
  ['link', 'background'], ['link', 'card'], ['foreground', 'row-hover'],
  ...['success', 'warning', 'error', 'info'].flatMap(status => [[status, 'background'], [status, 'card']]),
  ...['success', 'warning', 'error'].map(status => [status, `${status}-background`]),
];

describe('catalog token contrast', () => {
  it('validates hex and HSL arithmetic against black, white, and primary colors', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrast('0 0% 0%', '0 0% 100%')).toBeCloseTo(21, 10);
    expect(rgb('0 100% 50%')).toEqual([1, 0, 0]);
    expect(rgb('120 100% 50%')).toEqual([0, 1, 0]);
    expect(rgb('240 100% 50%')).toEqual([0, 0, 1]);
  });
  for (const theme of ['light', 'dark'] as const) {
    const palette = tokens(theme);
    for (const [fg, bg] of textPairs) {
      it(`${theme}: ${fg} on ${bg} meets 4.5:1`, () => {
        expect(palette[fg]).toBeDefined();
        expect(palette[bg]).toBeDefined();
        expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const boundary of ['ring', 'input']) {
      for (const background of ['background', 'card', 'muted']) {
        it(`${theme}: ${boundary} against ${background} meets 3:1`, () => {
          expect(contrast(palette[boundary], palette[background])).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
  it('keeps the pre-hydration system dark fallback identical to explicit dark mode', () => {
    const fallback = css.match(/:root:not\(\[data-theme\]\)\s*\{([^}]+)\}/)?.[1] || '';
    const values = Object.fromEntries([...fallback.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]]));
    expect(values).toEqual(tokens('dark'));
  });
  it('generates dark utilities for the same data-theme attribute as next-themes', async () => {
    const generated = await postcss([tailwindcss({ ...config, content: [{ raw: '<div class="dark:bg-card"></div>', extension: 'html' }] })])
      .process('@tailwind utilities;', { from: undefined });
    expect(generated.css).toContain(':where([data-theme="dark"], [data-theme="dark"] *)');
    expect(generated.css).not.toContain(':is(.dark *)');
  });
});
