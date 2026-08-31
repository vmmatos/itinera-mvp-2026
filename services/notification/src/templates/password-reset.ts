import type { RenderedEmail } from './welcome'

export interface PasswordResetData {
  name: string
  resetUrl: string
  expiresInMinutes: number
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderPasswordReset(data: PasswordResetData): RenderedEmail {
  const { name, resetUrl, expiresInMinutes } = data
  return {
    subject: 'Reset your Itinera password',
    html: `<h1>Hi ${escapeHtml(name)},</h1>
<p>We received a request to reset your Itinera password. Click the link below to choose a new one:</p>
<p><a href="${escapeHtml(resetUrl)}">Reset my password</a></p>
<p>This link expires in ${expiresInMinutes} minutes and can only be used once.</p>
<p>If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
    text: `Hi ${name},

We received a request to reset your Itinera password. Open this link to choose a new one:
${resetUrl}

This link expires in ${expiresInMinutes} minutes and can only be used once.

If you didn't request this, you can safely ignore this email — your password won't change.`,
  }
}
