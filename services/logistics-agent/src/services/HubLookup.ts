/**
 * Static lookup: remote/rural cities that lack a major transport hub of their own
 * (airport or main-line rail station) mapped to their nearest viable hub(s).
 *
 * Used by MultiLegRouter to compose realistic multi-segment journeys instead of
 * relying on the LLM to invent direct connections that don't exist.
 *
 * HubEntry fields:
 *  - hubCity    : the hub city to connect to (resolvable via Google Routes / SerpApi)
 *  - hubCountry : ISO-ish country name
 *  - hubType    : what the hub offers ('airport' | 'rail_major')
 *  - accessMode : how to reach the hub from the remote city
 *  - accessMinutes : approximate travel time to the hub
 *  - accessCostEur : approximate one-way cost per person in EUR
 */

export type HubType = 'airport' | 'rail_major';
export type AccessMode = 'bus' | 'train' | 'car';

export interface HubEntry {
  hubCity: string;
  hubCountry: string;
  hubType: HubType;
  accessMode: AccessMode;
  accessMinutes: number;
  accessCostEur: number;
}

/**
 * Keys are lowercase city names (no accents — normalize before lookup).
 * Multiple entries per city are ordered: best/fastest first.
 */
const HUB_MAP: Record<string, HubEntry[]> = {
  // --- Portugal coastal/rural ---
  comporta: [
    { hubCity: 'Grandola', hubCountry: 'PT', hubType: 'rail_major', accessMode: 'bus', accessMinutes: 40, accessCostEur: 4 },
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus', accessMinutes: 100, accessCostEur: 12 },
  ],
  mertola: [
    { hubCity: 'Beja', hubCountry: 'PT', hubType: 'rail_major', accessMode: 'bus', accessMinutes: 55, accessCostEur: 6 },
    { hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus', accessMinutes: 90, accessCostEur: 9 },
  ],
  sagres: [
    { hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus', accessMinutes: 90, accessCostEur: 8 },
    { hubCity: 'Lagos', hubCountry: 'PT', hubType: 'rail_major', accessMode: 'bus', accessMinutes: 30, accessCostEur: 3 },
  ],
  lagos: [
    { hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'train', accessMinutes: 90, accessCostEur: 8 },
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train', accessMinutes: 200, accessCostEur: 22 },
  ],
  tavira: [
    { hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'train', accessMinutes: 30, accessCostEur: 3 },
  ],
  silves: [
    { hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'train', accessMinutes: 50, accessCostEur: 5 },
  ],
  grandola: [
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train', accessMinutes: 90, accessCostEur: 10 },
  ],
  evora: [
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train', accessMinutes: 90, accessCostEur: 12 },
  ],
  beja: [
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train', accessMinutes: 150, accessCostEur: 18 },
    { hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus', accessMinutes: 80, accessCostEur: 7 },
  ],
  sintra: [
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train', accessMinutes: 40, accessCostEur: 3 },
  ],
  cascais: [
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train', accessMinutes: 40, accessCostEur: 3 },
  ],
  sesimbra: [
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus', accessMinutes: 60, accessCostEur: 5 },
  ],
  nazare: [
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus', accessMinutes: 90, accessCostEur: 10 },
  ],
  obidos: [
    { hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus', accessMinutes: 80, accessCostEur: 8 },
  ],
  // --- Spain ---
  ronda: [
    { hubCity: 'Malaga', hubCountry: 'ES', hubType: 'airport', accessMode: 'bus', accessMinutes: 100, accessCostEur: 12 },
    { hubCity: 'Sevilla', hubCountry: 'ES', hubType: 'rail_major', accessMode: 'bus', accessMinutes: 150, accessCostEur: 15 },
  ],
  tarifa: [
    { hubCity: 'Malaga', hubCountry: 'ES', hubType: 'airport', accessMode: 'bus', accessMinutes: 100, accessCostEur: 10 },
  ],
  toledo: [
    { hubCity: 'Madrid', hubCountry: 'ES', hubType: 'airport', accessMode: 'train', accessMinutes: 35, accessCostEur: 10 },
  ],
  // --- Ireland ---
  galway: [
    { hubCity: 'Dublin', hubCountry: 'IE', hubType: 'airport', accessMode: 'bus', accessMinutes: 150, accessCostEur: 14 },
  ],
  killarney: [
    { hubCity: 'Cork', hubCountry: 'IE', hubType: 'airport', accessMode: 'train', accessMinutes: 90, accessCostEur: 20 },
    { hubCity: 'Dublin', hubCountry: 'IE', hubType: 'airport', accessMode: 'train', accessMinutes: 180, accessCostEur: 35 },
  ],
};

/** Normalise a city name for lookup (lowercase, ASCII-ify common accents). */
export function normalise(city: string): string {
  return city
    .toLowerCase()
    .replace(/[àáâãä]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[ñ]/g, 'n')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Return the hub entries for a city, or empty array if it's already a major hub.
 */
export function getHubs(city: string): HubEntry[] {
  return HUB_MAP[normalise(city)] ?? [];
}
