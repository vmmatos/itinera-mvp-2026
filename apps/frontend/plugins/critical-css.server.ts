/**
 * Dev-only flash-of-unstyled-content bridge.
 *
 * Under `nuxt dev`, Vite serves every global stylesheet (globals.css, the
 * Tailwind layer) as a JS module whose `<link>` carries a `text/javascript`
 * MIME — the browser can't use it as a stylesheet, so the styles only land once
 * the client bundle has executed, i.e. *after* first paint. The auth pages take
 * the brunt of it: full-width, un-centred, wrong background until hydration
 * catches up.
 *
 * Emitting globals.css inline in the SSR <head> makes the first paint correct.
 * `nuxt build` already inlines critical CSS via Nitro, so this is scoped to dev
 * (the dynamic import keeps the raw sheet out of the production bundle) and to
 * `.server` (it never belongs in the client bundle). HMR is unaffected — Vite
 * still reinjects the stylesheet on edit.
 */
export default defineNuxtPlugin(async () => {
  if (!import.meta.dev) return
  const { default: globalsCss } = await import('~/assets/css/globals.css?raw')
  useHead({ style: [{ innerHTML: globalsCss, tagPriority: 'high' }] })
})
