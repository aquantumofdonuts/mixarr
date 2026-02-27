import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          border: 'hsl(var(--sidebar-border))',
        },
        status: {
          success: 'hsl(var(--success))',
          warning: 'hsl(var(--warning))',
          error: 'hsl(var(--error))',
          info: 'hsl(var(--info, 210 60% 50%))',
        },
      },
      width: {
        sidebar: '250px',
        'sidebar-collapsed': '64px',
      },
      transitionProperty: {
        width: 'width',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
        'slide-out': 'slideOut 0.2s ease-in',
        'spin-slow': 'spin 2s linear infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        slideOut: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
      fontFamily: {
        sans: ['var(--font-body)', 'DM Sans', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        'card': '1.25rem',    // 20px - generous card rounding
        'button': '0.625rem', // 10px - pill-ish buttons
      },
      boxShadow: {
        // Elevation system
        'elevation-1': '0 2px 8px rgba(0, 0, 0, 0.06)',
        'elevation-2': '0 4px 16px rgba(0, 0, 0, 0.1)',
        'elevation-3': '0 8px 30px rgba(0, 0, 0, 0.14)',
        'elevation-4': '0 16px 48px rgba(0, 0, 0, 0.18)',
        // Glow variants using Listening Room copper (#bf7a56)
        'glow-sm': '0 0 12px rgba(191, 122, 86, 0.2)',
        'glow-md': '0 4px 16px rgba(191, 122, 86, 0.3)',
        'glow-primary': '0 4px 20px rgba(191, 122, 86, 0.25), 0 0 0 1px rgba(191, 122, 86, 0.1)',
      },
    },
  },
  plugins: [],
};

export default config;
