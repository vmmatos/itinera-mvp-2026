import type { AuthUser } from '~/stores/auth'

/**
 * Result of a silent token-refresh attempt.
 *
 * `no-session`  — the backend answered 401/403: there is genuinely no valid
 *                 refresh cookie. Callers should tear the session down.
 * `transient`   — network error / timeout / 5xx / 429 / a lost refresh-token
 *                 rotation race. Callers must NOT tear an existing session down;
 *                 the next navigation or request retries.
 */
export type RefreshOutcome =
  | { ok: true; token: string; user?: AuthUser }
  | { ok: false; reason: 'no-session' | 'transient' }

interface RefreshResponse {
  success: boolean
  data: { token: string; user?: AuthUser }
}

// One shared in-flight request. Both the startup plugin (`plugins/auth.client.ts`
// via the store's `tryRefresh()`) and the `useApi` 401 interceptor call
// `refreshSession()`; without this they race two POSTs at `/api/auth/refresh`,
// and a backend that single-uses the refresh cookie fails the loser — which used
// to log a freshly-authenticated user straight back out.
let inflight: Promise<RefreshOutcome> | null = null

const RETRY_DELAY_MS = 300

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const statusOf = (err: unknown): number | undefined => {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; statusCode?: number; response?: { status?: number } }
    return e.status ?? e.statusCode ?? e.response?.status
  }
  return undefined
}

const attempt = async (): Promise<{ outcome: RefreshOutcome; retriable: boolean }> => {
  const config = useRuntimeConfig()
  try {
    const resp = await $fetch<RefreshResponse>(
      `${config.public.apiBase}/api/auth/refresh`,
      { method: 'POST', credentials: 'include', body: {} },
    )
    return { outcome: { ok: true, token: resp.data.token, user: resp.data.user }, retriable: false }
  } catch (err: unknown) {
    const status = statusOf(err)
    if (status === 401 || status === 403) {
      return { outcome: { ok: false, reason: 'no-session' }, retriable: false }
    }
    // Retry only a genuine network failure (no status) or a server error — never
    // a 429 (respect the backpressure) and never the 401/403 handled above.
    const retriable = status === undefined || status >= 500
    return { outcome: { ok: false, reason: 'transient' }, retriable }
  }
}

const run = async (): Promise<RefreshOutcome> => {
  const first = await attempt()
  if (first.outcome.ok || !first.retriable) return first.outcome
  await sleep(RETRY_DELAY_MS)
  return (await attempt()).outcome
}

/**
 * Silently refresh the access token from the httpOnly `refresh_token` cookie.
 * Concurrent callers share a single request; the promise is cleared once it
 * settles so a later call starts a fresh refresh.
 */
export const refreshSession = (): Promise<RefreshOutcome> => {
  if (inflight) return inflight
  inflight = run().finally(() => { inflight = null })
  return inflight
}

/** Test-only: drop any in-flight promise so cases start from a clean slate. */
export const __resetAuthRefreshForTests = (): void => {
  inflight = null
}
