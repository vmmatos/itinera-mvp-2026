import type { RenderedEmail } from './welcome'

export interface PasswordChangedData {
  name: string
  supportUrl?: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderPasswordChanged(data: PasswordChangedData): RenderedEmail {
  const { name, supportUrl = 'https://itinera.app/support' } = data
  return {
    subject: 'Your Itinera password was changed',
    html: `<h1>Hi ${escapeHtml(name)},</h1>
<p>Your Itinera password was just changed. If this was you, no action is needed.</p>
<p>If this <strong>wasn't</strong> you, someone may have access to your account. Reset your password again immediately and <a href="${escapeHtml(supportUrl)}">contact support</a>.</p>`,
    text: `Hi ${name},

Your Itinera password was just changed. If this was you, no action is needed.

If this wasn't you, someone may have access to your account. Reset your password again immediately and contact support: ${supportUrl}`,
  }
}
