import { describe, it, expect, beforeEach } from 'vitest'
import { authStoreMock } from '../../setup'
import plugin from '~/plugins/auth.client'

const run = plugin as unknown as () => Promise<void>

beforeEach(() => {
  authStoreMock.tryRefresh.mockClear().mockResolvedValue(true)
  authStoreMock.token = 'mock-token'
})

describe('auth.client plugin', () => {
  it('does not refresh when a token is already in memory', async () => {
    await run()
    expect(authStoreMock.tryRefresh).not.toHaveBeenCalled()
  })

  it('runs a single silent refresh when there is no token', async () => {
    authStoreMock.token = null
    await run()
    expect(authStoreMock.tryRefresh).toHaveBeenCalledTimes(1)
  })

  it('resolves even when the refresh fails', async () => {
    authStoreMock.token = null
    authStoreMock.tryRefresh.mockResolvedValue(false)
    await expect(run()).resolves.toBeUndefined()
  })
})
