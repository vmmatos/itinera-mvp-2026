// Login/register/OAuth callback must always render in English, regardless
// of any previously persisted itn-locale cookie from an earlier session.
export default defineNuxtRouteMiddleware((to) => {
  if (!to.path.startsWith('/auth')) return

  const { $i18n } = useNuxtApp()
  if ($i18n.locale.value !== 'en') {
    void $i18n.setLocale('en')
  }
})
