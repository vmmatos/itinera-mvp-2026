import { describe, it, expect } from 'vitest'
import { renderWelcome } from '@/templates/welcome'
import { renderItineraryReady } from '@/templates/itinerary-ready'
import { renderBookingReminder } from '@/templates/booking-reminder'
import { renderPasswordReset } from '@/templates/password-reset'
import { renderPasswordChanged } from '@/templates/password-changed'

describe('renderWelcome', () => {
  it('subject contains "Welcome" and html has firstName', () => {
    const result = renderWelcome({ firstName: 'Alice' })
    expect(result.subject).toContain('Welcome')
    expect(result.html).toContain('Alice')
    expect(result.text).toContain('Alice')
  })

  it('uses default loginUrl when not provided', () => {
    const result = renderWelcome({ firstName: 'Alice' })
    expect(result.html).toContain('https://itinera.app/login')
    expect(result.text).toContain('https://itinera.app/login')
  })

  it('uses provided loginUrl', () => {
    const result = renderWelcome({ firstName: 'Alice', loginUrl: 'https://custom.example.com' })
    expect(result.html).toContain('https://custom.example.com')
  })

  it('HTML-escapes <script> in firstName', () => {
    const result = renderWelcome({ firstName: '<script>alert(1)</script>' })
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
  })
})

describe('renderItineraryReady', () => {
  it('subject and html contain tripName', () => {
    const result = renderItineraryReady({
      firstName: 'Alice',
      tripName: 'Paris Trip',
      tripId: 'trip-123',
    })
    expect(result.subject).toContain('Paris Trip')
    expect(result.html).toContain('Paris Trip')
    expect(result.text).toContain('Paris Trip')
  })

  it('default viewUrl uses tripId', () => {
    const result = renderItineraryReady({
      firstName: 'Alice',
      tripName: 'Paris Trip',
      tripId: 'trip-abc',
    })
    expect(result.html).toContain('trip-abc')
    expect(result.text).toContain('trip-abc')
  })

  it('uses provided viewUrl', () => {
    const result = renderItineraryReady({
      firstName: 'Alice',
      tripName: 'Paris Trip',
      tripId: 'trip-123',
      viewUrl: 'https://custom.example.com/trip',
    })
    expect(result.html).toContain('https://custom.example.com/trip')
  })
})

describe('renderBookingReminder', () => {
  it('uses singular "day" when daysUntilTrip is 1', () => {
    const result = renderBookingReminder({
      firstName: 'Alice',
      tripName: 'Paris Trip',
      daysUntilTrip: 1,
    })
    expect(result.subject).toContain('1 day')
    expect(result.subject).not.toContain('1 days')
  })

  it('uses plural "days" when daysUntilTrip > 1', () => {
    const result = renderBookingReminder({
      firstName: 'Alice',
      tripName: 'Paris Trip',
      daysUntilTrip: 3,
    })
    expect(result.subject).toContain('3 days')
  })

  it('HTML-escapes & in tripName', () => {
    const result = renderBookingReminder({
      firstName: 'Alice',
      tripName: 'Paris & London',
      daysUntilTrip: 5,
    })
    expect(result.html).not.toContain('Paris & London')
    expect(result.html).toContain('Paris &amp; London')
  })

  it('uses default checklistUrl when not provided', () => {
    const result = renderBookingReminder({
      firstName: 'Alice',
      tripName: 'Paris Trip',
      daysUntilTrip: 5,
    })
    expect(result.html).toContain('https://itinera.app/checklist')
    expect(result.text).toContain('https://itinera.app/checklist')
  })
})

describe('renderPasswordReset', () => {
  const data = {
    name: 'Alice',
    resetUrl: 'https://app.test/auth/reset-password?token=abc123',
    expiresInMinutes: 30,
  }

  it('subject mentions a password reset', () => {
    expect(renderPasswordReset(data).subject.toLowerCase()).toContain('reset')
  })

  it('embeds the reset URL in both html and text', () => {
    const result = renderPasswordReset(data)
    expect(result.html).toContain(data.resetUrl)
    expect(result.text).toContain(data.resetUrl)
  })

  it('states the expiry window', () => {
    const result = renderPasswordReset(data)
    expect(result.html).toContain('30 minutes')
    expect(result.text).toContain('30 minutes')
  })

  it('HTML-escapes the name', () => {
    const result = renderPasswordReset({ ...data, name: '<script>alert(1)</script>' })
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
  })
})

describe('renderPasswordChanged', () => {
  it('subject says the password was changed', () => {
    expect(renderPasswordChanged({ name: 'Alice' }).subject.toLowerCase()).toContain('changed')
  })

  it('greets the user and warns about unrecognised changes', () => {
    const result = renderPasswordChanged({ name: 'Alice' })
    expect(result.html).toContain('Alice')
    expect(result.text.toLowerCase()).toContain("wasn't you")
  })

  it('uses the default support URL when none is given', () => {
    const result = renderPasswordChanged({ name: 'Alice' })
    expect(result.html).toContain('https://itinera.app/support')
  })
})
