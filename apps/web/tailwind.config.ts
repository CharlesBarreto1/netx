import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Design tokens — estilo "Linear" (denso, sóbrio, teclado-first).
 *
 * Todas as cores são referenciadas como `hsl(var(--token) / <alpha-value>)` —
 * assim dark mode é trocado só mexendo nas CSS vars em `globals.css`, sem
 * reescrita de classes. Use apenas os tokens semânticos abaixo (bg, surface,
 * border, text, ...). Paletas brutas (slate-*, brand-*) ainda existem para
 * compat, mas são deprecadas para código novo.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1440px' },
    },
    extend: {
      colors: {
        // --- Semantic tokens ---
        bg: 'hsl(var(--bg) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        'surface-muted': 'hsl(var(--surface-muted) / <alpha-value>)',
        'surface-hover': 'hsl(var(--surface-hover) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        'border-strong': 'hsl(var(--border-strong) / <alpha-value>)',
        text: 'hsl(var(--text) / <alpha-value>)',
        'text-muted': 'hsl(var(--text-muted) / <alpha-value>)',
        'text-subtle': 'hsl(var(--text-subtle) / <alpha-value>)',
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
          muted: 'hsl(var(--accent-muted) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger) / <alpha-value>)',
          foreground: 'hsl(var(--danger-foreground) / <alpha-value>)',
          muted: 'hsl(var(--danger-muted) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
          muted: 'hsl(var(--success-muted) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
          muted: 'hsl(var(--warning-muted) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
          muted: 'hsl(var(--info-muted) / <alpha-value>)',
        },
        ring: 'hsl(var(--ring) / <alpha-value>)',

        // --- Compat com código existente (deprecado em novos componentes) ---
        brand: {
          50:  'hsl(210 100% 97%)',
          100: 'hsl(210 100% 94%)',
          200: 'hsl(210 100% 88%)',
          300: 'hsl(210 96% 75%)',
          400: 'hsl(212 95% 63%)',
          500: 'hsl(214 95% 53%)',
          600: 'hsl(216 90% 46%)',
          700: 'hsl(218 88% 40%)',
          800: 'hsl(220 83% 34%)',
          900: 'hsl(224 76% 27%)',
        },
      },
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Inter',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: [
          'var(--font-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        // Escala densa (parte de 13px base, Linear-style)
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],    // 11px
        xs:   ['0.75rem',   { lineHeight: '1rem' }],     // 12px
        sm:   ['0.8125rem', { lineHeight: '1.125rem' }], // 13px
        base: ['0.875rem',  { lineHeight: '1.25rem' }],  // 14px
        md:   ['0.9375rem', { lineHeight: '1.375rem' }], // 15px
        lg:   ['1rem',      { lineHeight: '1.5rem' }],   // 16px
        xl:   ['1.125rem',  { lineHeight: '1.625rem' }], // 18px
        '2xl':['1.375rem',  { lineHeight: '1.75rem' }],  // 22px
        '3xl':['1.625rem',  { lineHeight: '2rem' }],     // 26px
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        // Sombras discretas Linear-style
        xs: '0 1px 2px 0 hsl(var(--shadow) / 0.08)',
        sm: '0 1px 3px 0 hsl(var(--shadow) / 0.10), 0 1px 2px -1px hsl(var(--shadow) / 0.06)',
        md: '0 4px 12px -2px hsl(var(--shadow) / 0.12), 0 2px 4px -2px hsl(var(--shadow) / 0.08)',
        lg: '0 12px 32px -6px hsl(var(--shadow) / 0.18), 0 4px 8px -4px hsl(var(--shadow) / 0.10)',
        pop: '0 0 0 1px hsl(var(--border) / 0.8), 0 8px 24px -4px hsl(var(--shadow) / 0.18)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(4px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-4px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 140ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'slide-down': 'slide-down 140ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
