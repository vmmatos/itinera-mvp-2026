/**
 * Curated dataset of major airports (Europe-heavy + world hubs) used to resolve
 * a destination — city, town, or region — to an IATA code for SerpApi Google
 * Flights, which requires airport codes rather than place names.
 *
 * Resolution strategy (see TransportService.resolveAirport):
 *  1. exact/normalised city-name match via `byCity`
 *  2. otherwise geocode the place and pick the closest airport via `nearestAirport`
 *
 * Coordinates are the airport's lat/lng. The list does not need to be exhaustive
 * — nearestAirport snaps any geocoded point to the closest major airport, which
 * matches how a traveller actually flies (e.g. the Gargano region → Bari/BRI).
 */

export interface Airport {
  iata: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
}

export const AIRPORTS: Airport[] = [
  // ── Portugal ──
  { iata: 'LIS', city: 'Lisboa', country: 'Portugal', lat: 38.7742, lng: -9.1342 },
  { iata: 'OPO', city: 'Porto', country: 'Portugal', lat: 41.2481, lng: -8.6814 },
  { iata: 'FAO', city: 'Faro', country: 'Portugal', lat: 37.0144, lng: -7.9659 },
  { iata: 'FNC', city: 'Funchal', country: 'Portugal', lat: 32.6979, lng: -16.7745 },
  { iata: 'PDL', city: 'Ponta Delgada', country: 'Portugal', lat: 37.7412, lng: -25.6979 },
  // ── Spain ──
  { iata: 'MAD', city: 'Madrid', country: 'Spain', lat: 40.4936, lng: -3.5668 },
  { iata: 'BCN', city: 'Barcelona', country: 'Spain', lat: 41.2974, lng: 2.0833 },
  { iata: 'AGP', city: 'Malaga', country: 'Spain', lat: 36.6749, lng: -4.4991 },
  { iata: 'SVQ', city: 'Sevilla', country: 'Spain', lat: 37.418, lng: -5.8931 },
  { iata: 'VLC', city: 'Valencia', country: 'Spain', lat: 39.4893, lng: -0.4816 },
  { iata: 'BIO', city: 'Bilbao', country: 'Spain', lat: 43.3011, lng: -2.9106 },
  { iata: 'PMI', city: 'Palma', country: 'Spain', lat: 39.5517, lng: 2.7388 },
  { iata: 'ALC', city: 'Alicante', country: 'Spain', lat: 38.2822, lng: -0.5582 },
  { iata: 'GRX', city: 'Granada', country: 'Spain', lat: 37.1887, lng: -3.7774 },
  { iata: 'LPA', city: 'Las Palmas', country: 'Spain', lat: 27.9319, lng: -15.3866 },
  { iata: 'TFN', city: 'Tenerife', country: 'Spain', lat: 28.4827, lng: -16.3415 },
  // ── France ──
  { iata: 'CDG', city: 'Paris', country: 'France', lat: 49.0097, lng: 2.5479 },
  { iata: 'ORY', city: 'Paris Orly', country: 'France', lat: 48.7233, lng: 2.3794 },
  { iata: 'NCE', city: 'Nice', country: 'France', lat: 43.6584, lng: 7.2159 },
  { iata: 'LYS', city: 'Lyon', country: 'France', lat: 45.7256, lng: 5.0811 },
  { iata: 'MRS', city: 'Marseille', country: 'France', lat: 43.4393, lng: 5.2214 },
  { iata: 'TLS', city: 'Toulouse', country: 'France', lat: 43.6293, lng: 1.3638 },
  { iata: 'BOD', city: 'Bordeaux', country: 'France', lat: 44.8283, lng: -0.7156 },
  { iata: 'NTE', city: 'Nantes', country: 'France', lat: 47.1532, lng: -1.6107 },
  { iata: 'MPL', city: 'Montpellier', country: 'France', lat: 43.5762, lng: 3.963 },
  { iata: 'BIA', city: 'Bastia', country: 'France', lat: 42.5527, lng: 9.4837 },
  // ── Italy ──
  { iata: 'FCO', city: 'Roma', country: 'Italy', lat: 41.8003, lng: 12.2389 },
  { iata: 'MXP', city: 'Milano', country: 'Italy', lat: 45.6306, lng: 8.7281 },
  { iata: 'LIN', city: 'Milano Linate', country: 'Italy', lat: 45.4451, lng: 9.2767 },
  { iata: 'BGY', city: 'Bergamo', country: 'Italy', lat: 45.6739, lng: 9.7042 },
  { iata: 'VCE', city: 'Venezia', country: 'Italy', lat: 45.5053, lng: 12.3519 },
  { iata: 'NAP', city: 'Napoli', country: 'Italy', lat: 40.886, lng: 14.2908 },
  { iata: 'BLQ', city: 'Bologna', country: 'Italy', lat: 44.5354, lng: 11.2887 },
  { iata: 'TRN', city: 'Torino', country: 'Italy', lat: 45.2008, lng: 7.6496 },
  { iata: 'PSA', city: 'Pisa', country: 'Italy', lat: 43.6839, lng: 10.3927 },
  { iata: 'FLR', city: 'Firenze', country: 'Italy', lat: 43.81, lng: 11.2051 },
  { iata: 'BRI', city: 'Bari', country: 'Italy', lat: 41.1389, lng: 16.7606 },
  { iata: 'BDS', city: 'Brindisi', country: 'Italy', lat: 40.6576, lng: 17.947 },
  { iata: 'CTA', city: 'Catania', country: 'Italy', lat: 37.4668, lng: 15.0664 },
  { iata: 'PMO', city: 'Palermo', country: 'Italy', lat: 38.176, lng: 13.091 },
  { iata: 'CAG', city: 'Cagliari', country: 'Italy', lat: 39.2515, lng: 9.0543 },
  { iata: 'PEG', city: 'Perugia', country: 'Italy', lat: 43.0959, lng: 12.5132 },
  { iata: 'GOA', city: 'Genova', country: 'Italy', lat: 44.4133, lng: 8.8375 },
  { iata: 'VRN', city: 'Verona', country: 'Italy', lat: 45.3957, lng: 10.8885 },
  // ── United Kingdom & Ireland ──
  { iata: 'LHR', city: 'London', country: 'United Kingdom', lat: 51.47, lng: -0.4543 },
  { iata: 'LGW', city: 'London Gatwick', country: 'United Kingdom', lat: 51.1537, lng: -0.1821 },
  { iata: 'STN', city: 'London Stansted', country: 'United Kingdom', lat: 51.885, lng: 0.235 },
  { iata: 'MAN', city: 'Manchester', country: 'United Kingdom', lat: 53.3537, lng: -2.275 },
  { iata: 'EDI', city: 'Edinburgh', country: 'United Kingdom', lat: 55.95, lng: -3.3725 },
  { iata: 'BRS', city: 'Bristol', country: 'United Kingdom', lat: 51.3827, lng: -2.7191 },
  { iata: 'DUB', city: 'Dublin', country: 'Ireland', lat: 53.4213, lng: -6.2701 },
  { iata: 'ORK', city: 'Cork', country: 'Ireland', lat: 51.8413, lng: -8.4911 },
  { iata: 'SNN', city: 'Shannon', country: 'Ireland', lat: 52.702, lng: -8.9248 },
  // ── Germany, Benelux, Alpine ──
  { iata: 'FRA', city: 'Frankfurt', country: 'Germany', lat: 50.0379, lng: 8.5622 },
  { iata: 'MUC', city: 'Munich', country: 'Germany', lat: 48.3538, lng: 11.7861 },
  { iata: 'BER', city: 'Berlin', country: 'Germany', lat: 52.3667, lng: 13.5033 },
  { iata: 'HAM', city: 'Hamburg', country: 'Germany', lat: 53.6304, lng: 9.9882 },
  { iata: 'DUS', city: 'Dusseldorf', country: 'Germany', lat: 51.2895, lng: 6.7668 },
  { iata: 'CGN', city: 'Cologne', country: 'Germany', lat: 50.8659, lng: 7.1427 },
  { iata: 'STR', city: 'Stuttgart', country: 'Germany', lat: 48.6899, lng: 9.2219 },
  { iata: 'AMS', city: 'Amsterdam', country: 'Netherlands', lat: 52.3105, lng: 4.7683 },
  { iata: 'BRU', city: 'Brussels', country: 'Belgium', lat: 50.9014, lng: 4.4844 },
  { iata: 'LUX', city: 'Luxembourg', country: 'Luxembourg', lat: 49.6266, lng: 6.2115 },
  { iata: 'ZRH', city: 'Zurich', country: 'Switzerland', lat: 47.4647, lng: 8.5492 },
  { iata: 'GVA', city: 'Geneva', country: 'Switzerland', lat: 46.2381, lng: 6.1089 },
  { iata: 'VIE', city: 'Vienna', country: 'Austria', lat: 48.1103, lng: 16.5697 },
  { iata: 'INN', city: 'Innsbruck', country: 'Austria', lat: 47.2602, lng: 11.344 },
  // ── Nordics ──
  { iata: 'OSL', city: 'Oslo', country: 'Norway', lat: 60.1939, lng: 11.1004 },
  { iata: 'BGO', city: 'Bergen', country: 'Norway', lat: 60.2934, lng: 5.2181 },
  { iata: 'TRD', city: 'Trondheim', country: 'Norway', lat: 63.4576, lng: 10.924 },
  { iata: 'CPH', city: 'Copenhagen', country: 'Denmark', lat: 55.618, lng: 12.656 },
  { iata: 'ARN', city: 'Stockholm', country: 'Sweden', lat: 59.6519, lng: 17.9186 },
  { iata: 'GOT', city: 'Gothenburg', country: 'Sweden', lat: 57.6685, lng: 12.2978 },
  { iata: 'HEL', city: 'Helsinki', country: 'Finland', lat: 60.3172, lng: 24.9633 },
  { iata: 'KEF', city: 'Reykjavik', country: 'Iceland', lat: 63.985, lng: -22.6056 },
  // ── Central & Eastern Europe ──
  { iata: 'PRG', city: 'Prague', country: 'Czechia', lat: 50.1008, lng: 14.26 },
  { iata: 'WAW', city: 'Warsaw', country: 'Poland', lat: 52.1657, lng: 20.9671 },
  { iata: 'KRK', city: 'Krakow', country: 'Poland', lat: 50.0777, lng: 19.7848 },
  { iata: 'BUD', city: 'Budapest', country: 'Hungary', lat: 47.4369, lng: 19.2556 },
  { iata: 'OTP', city: 'Bucharest', country: 'Romania', lat: 44.5711, lng: 26.085 },
  { iata: 'SOF', city: 'Sofia', country: 'Bulgaria', lat: 42.6967, lng: 23.4114 },
  { iata: 'ZAG', city: 'Zagreb', country: 'Croatia', lat: 45.7429, lng: 16.0688 },
  { iata: 'SPU', city: 'Split', country: 'Croatia', lat: 43.539, lng: 16.298 },
  { iata: 'DBV', city: 'Dubrovnik', country: 'Croatia', lat: 42.5614, lng: 18.2682 },
  { iata: 'LJU', city: 'Ljubljana', country: 'Slovenia', lat: 46.2237, lng: 14.4576 },
  { iata: 'BEG', city: 'Belgrade', country: 'Serbia', lat: 44.8184, lng: 20.3091 },
  // ── Greece, Balkans, Turkey ──
  { iata: 'ATH', city: 'Athens', country: 'Greece', lat: 37.9364, lng: 23.9445 },
  { iata: 'SKG', city: 'Thessaloniki', country: 'Greece', lat: 40.5197, lng: 22.9709 },
  { iata: 'HER', city: 'Heraklion', country: 'Greece', lat: 35.3397, lng: 25.1803 },
  { iata: 'IST', city: 'Istanbul', country: 'Turkey', lat: 41.2753, lng: 28.7519 },
  // ── Intercontinental hubs ──
  { iata: 'JFK', city: 'New York', country: 'United States', lat: 40.6413, lng: -73.7781 },
  { iata: 'EWR', city: 'Newark', country: 'United States', lat: 40.6895, lng: -74.1745 },
  { iata: 'LAX', city: 'Los Angeles', country: 'United States', lat: 33.9416, lng: -118.4085 },
  { iata: 'MIA', city: 'Miami', country: 'United States', lat: 25.7959, lng: -80.287 },
  { iata: 'YYZ', city: 'Toronto', country: 'Canada', lat: 43.6777, lng: -79.6248 },
  { iata: 'GRU', city: 'Sao Paulo', country: 'Brazil', lat: -23.4356, lng: -46.4731 },
  { iata: 'EZE', city: 'Buenos Aires', country: 'Argentina', lat: -34.8222, lng: -58.5358 },
  { iata: 'DXB', city: 'Dubai', country: 'United Arab Emirates', lat: 25.2532, lng: 55.3657 },
  { iata: 'DOH', city: 'Doha', country: 'Qatar', lat: 25.2731, lng: 51.608 },
  { iata: 'CMN', city: 'Casablanca', country: 'Morocco', lat: 33.3675, lng: -7.5899 },
  { iata: 'RAK', city: 'Marrakesh', country: 'Morocco', lat: 31.6069, lng: -8.0363 },
  { iata: 'CAI', city: 'Cairo', country: 'Egypt', lat: 30.1219, lng: 31.4056 },
  { iata: 'JNB', city: 'Johannesburg', country: 'South Africa', lat: -26.1392, lng: 28.246 },
  { iata: 'SID', city: 'Sal', country: 'Cape Verde', lat: 16.7414, lng: -22.9494 },
  { iata: 'RAI', city: 'Praia', country: 'Cape Verde', lat: 14.9245, lng: -23.4935 },
  { iata: 'SIN', city: 'Singapore', country: 'Singapore', lat: 1.3644, lng: 103.9915 },
  { iata: 'DPS', city: 'Denpasar', country: 'Indonesia', lat: -8.7482, lng: 115.1672 },
  { iata: 'HND', city: 'Tokyo', country: 'Japan', lat: 35.5494, lng: 139.7798 },
  { iata: 'BKK', city: 'Bangkok', country: 'Thailand', lat: 13.69, lng: 100.7501 },
  { iata: 'SYD', city: 'Sydney', country: 'Australia', lat: -33.9399, lng: 151.1753 },
];

/** Normalise a place/city name for matching: lowercase, strip accents + country suffix. */
function norm(name: string): string {
  return name
    .toLowerCase()
    .split(',')[0]!
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

const BY_CITY = new Map<string, Airport>();
for (const a of AIRPORTS) {
  const key = norm(a.city);
  if (!BY_CITY.has(key)) BY_CITY.set(key, a);
}

// Common English / alternate exonyms → dataset city, so either spelling resolves
// without a geocode round-trip (the parser/LLM may emit either form).
const CITY_ALIASES: Record<string, string> = {
  lisbon: 'lisboa', rome: 'roma', naples: 'napoli', milan: 'milano',
  florence: 'firenze', venice: 'venezia', turin: 'torino', genoa: 'genova',
  vienna: 'vienna', munich: 'munich', cologne: 'cologne', seville: 'sevilla',
  athens: 'athens', warsaw: 'warsaw', prague: 'prague', copenhagen: 'copenhagen',
  brussels: 'brussels', 'the hague': 'amsterdam', gothenburg: 'gothenburg',
  bali: 'denpasar', 'cabo verde': 'sal', 'cape verde': 'sal',
};

/** Exact/normalised city-name match (with common exonyms). Returns the airport or undefined. */
export function byCity(name: string): Airport | undefined {
  const key = norm(name);
  return BY_CITY.get(key) ?? BY_CITY.get(CITY_ALIASES[key] ?? '');
}

/** Great-circle distance between two coordinates in km (haversine). */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Closest airport to a coordinate by great-circle distance. */
export function nearestAirport(lat: number, lng: number): Airport {
  return nearestAirports(lat, lng, 1)[0]!;
}

/** The `n` closest airports to a coordinate, nearest first. */
export function nearestAirports(lat: number, lng: number, n: number): Airport[] {
  return AIRPORTS
    .map((a) => ({ a, km: haversineKm(lat, lng, a.lat, a.lng) }))
    .sort((x, y) => x.km - y.km)
    .slice(0, Math.max(1, n))
    .map((x) => x.a);
}
