// Maps the semantic color names produced by negotiationReducer.colorFor()
// to this app's existing dark/mono design tokens (assets/css/globals.css).
const TOKENS: Record<string, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  blue: 'var(--blue)',
  magenta: 'var(--magenta)',
  neutral: 'var(--fg-0)',
}

export function agentColorToken(color: string): string {
  return TOKENS[color] ?? 'var(--fg-2)'
}
