// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },

  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@nuxtjs/i18n',
  ],

  // ── i18n ─────────────────────────────────────────────────────
  // Language is a user preference (settings.vue), not a routed concern,
  // so no locale-prefixed URLs. Login/register always render in English
  // regardless of this cookie — see middleware/force-en-locale.global.ts.
  i18n: {
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'pt', name: 'Portuguese', file: 'pt.json' },
    ],
    defaultLocale: 'en',
    langDir: 'locales/',
    strategy: 'no_prefix',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'itn-locale',
      redirectOn: 'no prefix',
    },
  },

  // ── CSS global ───────────────────────────────────────────────
  css: ['~/assets/css/globals.css'],

  // ── Runtime config ───────────────────────────────────────────
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost',
      wsUrl:   process.env.NUXT_PUBLIC_WS_URL   ?? 'http://localhost',
      appMode: process.env.NUXT_PUBLIC_APP_MODE ?? 'development',
    },
  },

  // ── TypeScript ───────────────────────────────────────────────
  typescript: {
    strict: true,
    typeCheck: false,
  },

  // ── App head ─────────────────────────────────────────────────
  app: {
    head: {
      title: 'itinera',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Multi-agent AI group travel planner' },
        { name: 'theme-color', content: '#0a0a0a' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@300;400;500;600&display=swap',
        },
      ],
      // Dark is always the SSR default (no data-theme attribute). This
      // runs before first paint to correct for a persisted light choice,
      // avoiding a flash — see stores/theme.ts for the matching storageKey.
      script: [
        {
          innerHTML: "(function(){try{var m=localStorage.getItem('itn-theme');if(m==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();",
        },
      ],
    },
  },

  // ── Security headers ─────────────────────────────────────────
  routeRules: {
    // Auth-gated area: 100% user-specific, fetched client-side in onMounted,
    // gated by an in-memory token. SSR only paints a skeleton for a request
    // that has no token yet, then the client redirects — the "flash to
    // dashboard then back to login" bug. Render these client-side only.
    '/':          { ssr: false },
    '/dashboard': { ssr: false },
    '/planner':   { ssr: false },
    '/trips/**':  { ssr: false },
    '/admin':     { ssr: false },
    '/admin/**':  { ssr: false },
    '/**': {
      headers: {
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",  // unsafe-inline required for Nuxt SSR hydration
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "connect-src 'self' ws: wss:",
          "img-src 'self' data: blob:",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      },
    },
  },

  // ── Nitro (SSR) ──────────────────────────────────────────────
  nitro: {
    preset: 'node-server',
  },

  // ── Dev server ───────────────────────────────────────────────
  devServer: {
    host: '0.0.0.0',
    port: 3000,
  },
})
