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
    description: 'Sophisticated dark',
    colors: {
      primary: '#C9A227',
      accent: '#C9A227',
      background: '#0D0D0D',
    },
  },
  {
    id: 'editorial-clean',
    name: 'Editorial',
    description: 'Minimal black & white',
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
    description: 'Gentle pastels',
    colors: {
      primary: '#8B5CF6',
      accent: '#EC4899',
      background: '#FAF5FF',
    },
  },
  {
    id: 'vinyl-retro',
    name: 'Vinyl Retro',
    description: 'Warm vintage vibes',
    colors: {
      primary: '#F97316',
      accent: '#F97316',
      background: '#1C1917',
    },
  },
  {
    id: 'midnight-modern',
    name: 'Midnight Modern',
    description: 'Clean dark and vibrant',
    colors: {
      primary: '#22C55E',
      accent: '#A855F7',
      background: '#0F172A',
    },
  },
];

export const DEFAULT_THEME = 'midnight-modern';
