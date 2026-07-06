/**
 * Static lookup: remote/rural cities that lack a major transport hub of their own
 * (airport or main-line rail station) mapped to their nearest viable hub(s).
 *
 * Used by MultiLegRouter to compose realistic multi-segment journeys instead of
 * relying on the LLM to invent direct connections that don't exist.
 *
 * HubEntry fields:
 *  - hubCity        : the hub city to connect to (resolvable via Google Routes / SerpApi)
 *  - hubCountry     : ISO-ish country name
 *  - hubType        : what the hub offers ('airport' | 'rail_major')
 *  - accessMode     : how to reach the hub from the remote city
 *  - accessMinutes  : approximate travel time to the hub
 *  - accessCostEur  : approximate one-way cost per person in EUR
 *  - accessProvider : bus/train company name operating the access leg
 *  - accessFromStop : departure stop / terminal name in the origin city
 *  - accessToStop   : arrival stop / station name in the hub city
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
  accessProvider?: string;
  accessFromStop?: string;
  accessToStop?: string;
}

/**
 * Keys are lowercase city names (no accents — normalize before lookup).
 * Multiple entries per city are ordered: best/fastest first.
 */
const HUB_MAP: Record<string, HubEntry[]> = {
  // --- Portugal coastal/rural ---
  comporta: [
    {
      hubCity: 'Grandola', hubCountry: 'PT', hubType: 'rail_major', accessMode: 'bus',
      accessMinutes: 40, accessCostEur: 4,
      accessProvider: 'Rede Expressos',
      accessFromStop: 'Comporta (main stop, Rua do Secador)',
      accessToStop: 'Grândola train station (Estação de Grândola)',
    },
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 100, accessCostEur: 12,
      accessProvider: 'Rede Expressos',
      accessFromStop: 'Comporta (main stop, Rua do Secador)',
      accessToStop: 'Lisboa — Sete Rios bus terminal',
    },
  ],
  mertola: [
    {
      hubCity: 'Beja', hubCountry: 'PT', hubType: 'rail_major', accessMode: 'bus',
      accessMinutes: 55, accessCostEur: 6,
      accessProvider: 'Eva Transportes',
      accessFromStop: 'Mértola bus terminal (Largo Vasco da Gama)',
      accessToStop: 'Beja train station (Estação de Beja)',
    },
    {
      hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 90, accessCostEur: 9,
      accessProvider: 'Eva Transportes',
      accessFromStop: 'Mértola bus terminal (Largo Vasco da Gama)',
      accessToStop: 'Faro Airport bus stop',
    },
  ],
  sagres: [
    {
      hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 90, accessCostEur: 8,
      accessProvider: 'Eva Transportes',
      accessFromStop: 'Sagres bus terminal',
      accessToStop: 'Faro Airport bus stop',
    },
    {
      hubCity: 'Lagos', hubCountry: 'PT', hubType: 'rail_major', accessMode: 'bus',
      accessMinutes: 30, accessCostEur: 3,
      accessProvider: 'Eva Transportes',
      accessFromStop: 'Sagres bus terminal',
      accessToStop: 'Lagos train station (Estação de Lagos)',
    },
  ],
  lagos: [
    {
      hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'train',
      accessMinutes: 90, accessCostEur: 8,
      accessProvider: 'CP — Comboios de Portugal',
      accessFromStop: 'Lagos train station (Estação de Lagos)',
      accessToStop: 'Faro train station (Estação de Faro)',
    },
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train',
      accessMinutes: 200, accessCostEur: 22,
      accessProvider: 'CP — Comboios de Portugal (Intercidades)',
      accessFromStop: 'Lagos train station (Estação de Lagos)',
      accessToStop: 'Lisboa Oriente train station',
    },
  ],
  tavira: [
    {
      hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'train',
      accessMinutes: 30, accessCostEur: 3,
      accessProvider: 'CP — Comboios de Portugal',
      accessFromStop: 'Tavira train station (Estação de Tavira)',
      accessToStop: 'Faro train station (Estação de Faro)',
    },
  ],
  silves: [
    {
      hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'train',
      accessMinutes: 50, accessCostEur: 5,
      accessProvider: 'CP — Comboios de Portugal',
      accessFromStop: 'Silves train station (Estação de Silves)',
      accessToStop: 'Faro train station (Estação de Faro)',
    },
  ],
  grandola: [
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train',
      accessMinutes: 90, accessCostEur: 10,
      accessProvider: 'CP — Comboios de Portugal (Intercidades)',
      accessFromStop: 'Grândola train station (Estação de Grândola)',
      accessToStop: 'Lisboa Oriente train station',
    },
  ],
  evora: [
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train',
      accessMinutes: 90, accessCostEur: 12,
      accessProvider: 'CP — Comboios de Portugal (Intercidades)',
      accessFromStop: 'Évora train station (Estação de Évora)',
      accessToStop: 'Lisboa Oriente train station',
    },
  ],
  beja: [
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train',
      accessMinutes: 150, accessCostEur: 18,
      accessProvider: 'CP — Comboios de Portugal (Intercidades)',
      accessFromStop: 'Beja train station (Estação de Beja)',
      accessToStop: 'Lisboa Oriente train station',
    },
    {
      hubCity: 'Faro', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 80, accessCostEur: 7,
      accessProvider: 'Eva Transportes',
      accessFromStop: 'Beja bus terminal (Terminal Rodoviário de Beja)',
      accessToStop: 'Faro Airport bus stop',
    },
  ],
  sintra: [
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train',
      accessMinutes: 40, accessCostEur: 3,
      accessProvider: 'CP — Comboios de Portugal (Linha de Sintra)',
      accessFromStop: 'Sintra train station (Estação de Sintra)',
      accessToStop: 'Lisboa Rossio train station',
    },
  ],
  cascais: [
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'train',
      accessMinutes: 40, accessCostEur: 3,
      accessProvider: 'CP — Comboios de Portugal (Linha de Cascais)',
      accessFromStop: 'Cascais train station (Estação de Cascais)',
      accessToStop: 'Lisboa Cais do Sodré train station',
    },
  ],
  sesimbra: [
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 60, accessCostEur: 5,
      accessProvider: 'TST — Transportes Sul do Tejo',
      accessFromStop: 'Sesimbra bus terminal',
      accessToStop: 'Lisboa — Praça de Espanha bus terminal',
    },
  ],
  nazare: [
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 90, accessCostEur: 10,
      accessProvider: 'Rede Expressos',
      accessFromStop: 'Nazaré bus stop (Avenida da República)',
      accessToStop: 'Lisboa — Sete Rios bus terminal',
    },
  ],
  obidos: [
    {
      hubCity: 'Lisboa', hubCountry: 'PT', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 80, accessCostEur: 8,
      accessProvider: 'Rede Expressos',
      accessFromStop: 'Óbidos bus stop (Rua Direita)',
      accessToStop: 'Lisboa — Sete Rios bus terminal',
    },
  ],
  // --- Spain ---
  ronda: [
    {
      hubCity: 'Malaga', hubCountry: 'ES', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 100, accessCostEur: 12,
      accessProvider: 'Comes / Avanza',
      accessFromStop: 'Ronda bus station (Estación de Autobuses de Ronda)',
      accessToStop: 'Málaga bus station (Estación de Autobuses María Zambrano)',
    },
    {
      hubCity: 'Sevilla', hubCountry: 'ES', hubType: 'rail_major', accessMode: 'bus',
      accessMinutes: 150, accessCostEur: 15,
      accessProvider: 'Comes',
      accessFromStop: 'Ronda bus station (Estación de Autobuses de Ronda)',
      accessToStop: 'Sevilla — Plaza de Armas bus station',
    },
  ],
  tarifa: [
    {
      hubCity: 'Malaga', hubCountry: 'ES', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 100, accessCostEur: 10,
      accessProvider: 'Comes',
      accessFromStop: 'Tarifa bus station (Avenida de Andalucía)',
      accessToStop: 'Málaga bus station (Estación de Autobuses María Zambrano)',
    },
  ],
  toledo: [
    {
      hubCity: 'Madrid', hubCountry: 'ES', hubType: 'airport', accessMode: 'train',
      accessMinutes: 35, accessCostEur: 10,
      accessProvider: 'Renfe (AVE/Avant)',
      accessFromStop: 'Toledo train station (Estación de Toledo)',
      accessToStop: 'Madrid Atocha train station',
    },
  ],
  // --- Ireland ---
  galway: [
    {
      hubCity: 'Dublin', hubCountry: 'IE', hubType: 'airport', accessMode: 'bus',
      accessMinutes: 150, accessCostEur: 14,
      accessProvider: 'Bus Éireann (X20 / Citylink)',
      accessFromStop: 'Galway Coach Station (Ceannt Station)',
      accessToStop: 'Dublin Airport — Terminal 1 & 2',
    },
  ],
  killarney: [
    {
      hubCity: 'Cork', hubCountry: 'IE', hubType: 'airport', accessMode: 'train',
      accessMinutes: 90, accessCostEur: 20,
      accessProvider: 'Irish Rail (InterCity)',
      accessFromStop: 'Killarney train station',
      accessToStop: 'Cork Kent train station',
    },
    {
      hubCity: 'Dublin', hubCountry: 'IE', hubType: 'airport', accessMode: 'train',
      accessMinutes: 180, accessCostEur: 35,
      accessProvider: 'Irish Rail (InterCity)',
      accessFromStop: 'Killarney train station',
      accessToStop: 'Dublin Heuston train station',
    },
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
