export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  ssr: false,

  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    '@vueuse/nuxt',
  ],

  css: ['~/assets/css/globals.css'],

  runtimeConfig: {
    public: {
      apiUrl:  process.env['NUXT_PUBLIC_API_URL']  ?? 'http://localhost:8000',
      wsUrl:   process.env['NUXT_PUBLIC_WS_URL']   ?? 'http://localhost:8000',
      appMode: process.env['NUXT_PUBLIC_APP_MODE'] ?? 'development',
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  app: {
    head: {
      title: 'itinera',
      meta: [
        { name: 'description', content: 'Multi-agent AI group travel planner' },
        { name: 'theme-color', content: '#0a0a0a' },
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      link: [
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@300;400;500;600&display=swap',
        },
      ],
    },
  },

  nitro: {
    preset: 'node-server',
  },

  devServer: {
    host: '0.0.0.0',
    port: 3000,
  },
})
