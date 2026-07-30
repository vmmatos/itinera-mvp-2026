import type { Config } from 'tailwindcss'

export default {
  content: [
    './components/**/*.{vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './composables/**/*.ts',
    './app.vue',
  ],
  theme: {
    extend: {
      // ── Colours (from design system) ──────────────────────────
      colors: {
        // Backgrounds — reference the runtime CSS custom properties (see
        // assets/css/globals.css) so utility classes track the active
        // [data-theme] instead of a hex baked in at build time.
        'bg-0': 'var(--bg-0)',
        'bg-1': 'var(--bg-1)',
        'bg-2': 'var(--bg-2)',
        'bg-3': 'var(--bg-3)',

        // Foregrounds
        'fg-0': 'var(--fg-0)',
        'fg-1': 'var(--fg-1)',
        'fg-2': 'var(--fg-2)',
        'fg-3': 'var(--fg-3)',
        'fg-4': 'var(--fg-4)',

        // Lines / borders
        'line-1': 'var(--line-1)',
        'line-2': 'var(--line-2)',
        'line-3': 'var(--line-3)',

        // Accent — electric green (text/icon/border role; --lime/--lime-2
        // in globals.css hold the always-bright fill role)
        green: {
          DEFAULT: 'var(--green)',
          dim:     'var(--green-dim)',
          dark:    'var(--green-dark)',
          bg:      'var(--green-bg)',
          line:    'var(--green-line)',
        },

        // Agent colours (each agent has a distinct accent)
        amber: {
          DEFAULT: 'var(--amber)',
          bg:      'var(--amber-bg)',
          line:    'var(--amber-line)',
        },
        blue: {
          DEFAULT: 'var(--blue)',
          bg:      'var(--blue-bg)',
          line:    'var(--blue-line)',
        },
        magenta: {
          DEFAULT: 'var(--magenta)',
          bg:      'var(--magenta-bg)',
          line:    'var(--magenta-line)',
        },
        red: 'var(--red)',
      },

      // ── Typography ────────────────────────────────────────────
      fontFamily: {
        sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        '12': ['11px', { lineHeight: '1.5' }],
        '13': ['12px', { lineHeight: '1.5' }],
        '14': ['13px', { lineHeight: '1.5' }],
        '15': ['14px', { lineHeight: '1.5' }],  // base
        '16': ['15px', { lineHeight: '1.5' }],
        '18': ['17px', { lineHeight: '1.4' }],
        '22': ['21px', { lineHeight: '1.3' }],
        '28': ['27px', { lineHeight: '1.2' }],
        '40': ['38px', { lineHeight: '1.1' }],
        '64': ['60px', { lineHeight: '1.0' }],
      },

      // ── Spacing (4px base grid) ────────────────────────────────
      spacing: {
        '1':  '4px',
        '2':  '8px',
        '3':  '12px',
        '4':  '16px',
        '5':  '20px',
        '6':  '24px',
        '8':  '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
        '20': '80px',
        '24': '96px',
      },

      // ── Border radius ─────────────────────────────────────────
      borderRadius: {
        'sm': '2px',   // --r-1
        'md': '4px',   // --r-2
        'lg': '6px',   // --r-3
      },

      // ── Border widths ─────────────────────────────────────────
      borderWidth: {
        DEFAULT: '1px',
        'hair': '1px',
      },

      // ── Background opacity helpers ────────────────────────────
      backgroundOpacity: {
        '8': '0.08',
      },
    },
  },
  plugins: [],
} satisfies Config
