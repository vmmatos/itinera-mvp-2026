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
        // Backgrounds
        'bg-0': '#0a0a0a',
        'bg-1': '#111111',
        'bg-2': '#161616',
        'bg-3': '#1c1c1c',

        // Foregrounds
        'fg-0': '#f2f2f2',
        'fg-1': '#c9c9c9',
        'fg-2': '#a1a1a1',
        'fg-3': '#666666',
        'fg-4': '#3a3a3a',

        // Lines / borders
        'line-1': '#1f1f1f',
        'line-2': '#272727',
        'line-3': '#333333',

        // Accent — electric green
        green: {
          DEFAULT: '#00ff88',
          dim:     '#00cc6e',
          dark:    '#00b85f',
          bg:      'rgba(0,255,136,0.08)',
          line:    'rgba(0,255,136,0.32)',
        },

        // Agent colours (each agent has a distinct accent)
        amber: {
          DEFAULT: '#ffb547',
          bg:      'rgba(255,181,71,0.08)',
          line:    'rgba(255,181,71,0.32)',
        },
        blue: {
          DEFAULT: '#5b9dff',
          bg:      'rgba(91,157,255,0.08)',
          line:    'rgba(91,157,255,0.32)',
        },
        magenta: {
          DEFAULT: '#d36bff',
          bg:      'rgba(211,107,255,0.08)',
          line:    'rgba(211,107,255,0.32)',
        },
        red: '#ff5d5d',
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
