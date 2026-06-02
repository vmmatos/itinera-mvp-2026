// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },

  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    '@vueuse/nuxt',
  ],

  // ── CSS global ───────────────────────────────────────────────
  css: ['~/assets/css/globals.css'],

  // ── Runtime config ───────────────────────────────────────────
  runtimeConfig: {
    public: {
      apiUrl:  process.env.NUXT_PUBLIC_API_URL  ?? 'http://localhost:8000',
      wsUrl:   process.env.NUXT_PUBLIC_WS_URL   ?? 'http://localhost:8000',
      appMode: process.env.NUXT_PUBLIC_APP_MODE ?? 'development',
    },
  },

  // ── TypeScript ───────────────────────────────────────────────
  typescript: {
    strict: true,
    typeCheck: true,
  },

  // ── App head ─────────────────────────────────────────────────
  app: {
    head: {
      title: 'itinera',
      meta: [
        { name: 'description', content: 'Multi-agent AI group travel planner' },
        { name: 'theme-color', content: '#0a0a0a' },
      ],
      link: [
        // Geist font from Vercel CDN
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@300;400;500;600&display=swap',
        },
      ],
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
