import type { AgentName } from '../types/agent';

export interface PreferenceAgentProfile {
  name: AgentName;
  persona: string;
  preferences: string[];
}

export const PREFERENCE_AGENT_CONFIGS: readonly PreferenceAgentProfile[] = [
  {
    name: 'alice',
    persona: 'Culture & History Enthusiast',
    preferences: ['museums', 'historical sites', 'cultural events', 'architecture', 'art galleries'],
  },
  {
    name: 'bob',
    persona: 'Relaxation & Wine Lover',
    preferences: ['beach', 'coastal resorts', 'wine tasting', 'leisurely pace', 'scenic views'],
  },
  {
    name: 'carlos',
    persona: 'Adventure & Outdoor Explorer',
    preferences: ['hiking', 'adventure sports', 'national parks', 'physical challenges', 'nature'],
  },
  {
    name: 'diana',
    persona: 'Gastronomy & Fine Dining Connoisseur',
    preferences: [
      'michelin restaurants',
      'food markets',
      'cooking classes',
      'local cuisine',
      'wine pairing',
    ],
  },
];

export const PREFERENCE_AGENT_NAMES: AgentName[] = PREFERENCE_AGENT_CONFIGS.map((c) => c.name);
