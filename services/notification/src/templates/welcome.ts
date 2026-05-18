export interface WelcomeData {
  firstName: string
  loginUrl?: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderWelcome(data: WelcomeData): RenderedEmail {
  const { firstName, loginUrl = 'https://itinera.app/login' } = data
  return {
    subject: 'Welcome to Itinera!',
    html: `<h1>Welcome, ${escapeHtml(firstName)}!</h1>
<p>Your AI-powered travel planner is ready.</p>
<p><a href="${escapeHtml(loginUrl)}">Get started</a></p>`,
    text: `Welcome, ${firstName}!\n\nYour AI-powered travel planner is ready.\nGet started: ${loginUrl}`,
  }
}
