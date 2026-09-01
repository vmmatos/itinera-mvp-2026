import { describe, it, expect, beforeEach } from 'vitest'
import { authStoreMock, mockNavigateTo } from '../../setup'
import middleware from '~/middleware/auth'

const run = (path: string) => (middleware as unknown as (to: { path: string }) => unknown)({ path })

beforeEach(() => {
  mockNavigateTo.mockClear()
  authStoreMock.tryRefresh.mockClear()
  authStoreMock.token = 'mock-token'
  authStoreMock.user = { id: 'u1', name: 'U', email: 'u@u.com', role: 'user', language: 'en', theme: 'dark', hasSeenWalkthrough: false }
})

describe('auth route middleware', () => {
  it('lets /auth/* through untouched', () => {
    expect(run('/auth/login')).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('redirects to login when there is no token — without calling tryRefresh', () => {
    authStoreMock.token = null

    run('/dashboard')

    expect(mockNavigateTo).toHaveBeenCalledWith('/auth/login', { replace: true })
    expect(authStoreMock.tryRefresh).not.toHaveBeenCalled()
  })

  it('bounces a non-admin away from /admin/*', () => {
    run('/admin/trip-1')
    expect(mockNavigateTo).toHaveBeenCalledWith('/dashboard', { replace: true })
  })

  it('lets an admin into /admin/*', () => {
    authStoreMock.user = { id: 'u1', name: 'U', email: 'u@u.com', role: 'admin', language: 'en', theme: 'dark', hasSeenWalkthrough: false }
    expect(run('/admin/trip-1')).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('lets an authenticated user into a normal protected route', () => {
    expect(run('/dashboard')).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })
})
