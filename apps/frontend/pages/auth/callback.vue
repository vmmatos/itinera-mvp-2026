<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const authStore = useAuthStore()

interface JwtTokenPayload {
  sub: string
  email: string
  name: string
  role: string
  iss: string
  exp: number
}

const decodeJwt = (token: string): JwtTokenPayload => {
  const base64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
  if (!base64) throw new Error('Invalid token format')
  return JSON.parse(atob(base64)) as JwtTokenPayload
}

onMounted(() => {
  const token = route.query['token'] as string | undefined
  if (!token) {
    navigateTo('/auth/login?error=oauth_failed', { replace: true })
    return
  }

  try {
    const payload = decodeJwt(token)
    authStore.setFromOAuth({
      token,
      user: { id: payload.sub, email: payload.email, name: payload.name, role: payload.role },
    })
    navigateTo('/', { replace: true })
  } catch {
    navigateTo('/auth/login?error=oauth_failed', { replace: true })
  }
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-fg-3 text-14">Signing you in...</div>
  </div>
</template>
