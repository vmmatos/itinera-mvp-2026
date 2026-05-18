import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEmailTransport } from '@/services/EmailService'
import type { Config } from '@/config'

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>()
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  }
})

const { mockSendMail, mockSgSend, mockSgSetApiKey } = vi.hoisted(() => {
  const mockSendMail = vi.fn().mockResolvedValue({})
  const mockSgSend = vi.fn().mockResolvedValue([{ statusCode: 202 }])
  const mockSgSetApiKey = vi.fn()
  return { mockSendMail, mockSgSend, mockSgSetApiKey }
})

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({ sendMail: mockSendMail }),
  },
}))

vi.mock('@sendgrid/mail', () => ({
  default: { setApiKey: mockSgSetApiKey, send: mockSgSend },
}))

const smtpConfig = {
  SENDGRID_ENABLED: false,
  SENDGRID_API_KEY: undefined,
  SMTP_HOST: 'mailhog',
  SMTP_PORT: 1025,
} as unknown as Config

const sgConfig = {
  SENDGRID_ENABLED: true,
  SENDGRID_API_KEY: 'SG.testkey',
  SMTP_HOST: 'mailhog',
  SMTP_PORT: 1025,
} as unknown as Config

const rendered = {
  subject: 'Test subject',
  html: '<p>Hello</p>',
  text: 'Hello',
}
const from = { email: 'noreply@itinera.dev', name: 'Itinera' }

describe('createEmailTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMail.mockResolvedValue({})
    mockSgSend.mockResolvedValue([{ statusCode: 202 }])
  })

  it('returns SMTP transport when SENDGRID_ENABLED=false', () => {
    const transport = createEmailTransport(smtpConfig)
    expect(transport).toBeDefined()
    expect(typeof transport.send).toBe('function')
  })

  it('SMTP transport calls sendMail with correct fields', async () => {
    const transport = createEmailTransport(smtpConfig)
    await transport.send('user@example.com', from, rendered)
    expect(mockSendMail).toHaveBeenCalledOnce()
    const call = mockSendMail.mock.calls[0][0] as Record<string, unknown>
    expect(call.to).toBe('user@example.com')
    expect(call.subject).toBe('Test subject')
    expect(call.html).toBe('<p>Hello</p>')
    expect(call.text).toBe('Hello')
  })

  it('returns SendGrid transport when SENDGRID_ENABLED=true and key present', async () => {
    const transport = createEmailTransport(sgConfig)
    await transport.send('user@example.com', from, rendered)
    expect(mockSgSetApiKey).toHaveBeenCalledWith('SG.testkey')
    expect(mockSgSend).toHaveBeenCalledOnce()
  })

  it('throws when SENDGRID_ENABLED=true but key missing', () => {
    const badConfig = { ...sgConfig, SENDGRID_API_KEY: undefined } as unknown as Config
    expect(() => createEmailTransport(badConfig)).toThrow(
      'SENDGRID_API_KEY must be set when SENDGRID_ENABLED=true',
    )
  })

  it('SMTP transport propagates sendMail errors', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP connection refused'))
    const transport = createEmailTransport(smtpConfig)
    await expect(transport.send('user@example.com', from, rendered)).rejects.toThrow(
      'SMTP connection refused',
    )
  })
})
