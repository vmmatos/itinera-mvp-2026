import { BaseService, foldTerm } from '@itinera/shared';
import type { IAIProvider } from '@itinera/shared';

export interface ParsedDestination {
  city: string;
  country: string;
  nights: number;
}

/**
 * Trip brief handed to the LLM when it has to pick cities for a bare country, so
 * the route matches the group's size, pace and interests instead of always
 * returning the same tourist-guide default.
 */
export interface DestinationBrief {
  groupSize?: number;
  pace?: 'low' | 'medium' | 'high';
  mustHaves?: string[];
  avoids?: string[];
}

export interface ParseOptions {
  /**
   * Allow the LLM country→cities expansion (and the cities-without-country
   * extraction). Off for the read-only form preview so a keystroke never spends
   * Anthropic tokens — the preview shows the bare-country marker instead.
   * Default true.
   */
  allowExpansion?: boolean;
  brief?: DestinationBrief;
}

export interface DestinationParserOptions {
  /** Master switch for country→cities expansion. Default true. */
  expansionEnabled?: boolean;
  /**
   * Return fixture cities instead of calling the LLM — dev without an
   * ANTHROPIC_API_KEY still gets a real city route. Default false.
   */
  expansionMock?: boolean;
}

/**
 * Maps free-text country names (PT/ES/EN + common variants) to a canonical
 * English display name. Used to classify tokens in the free-text region string.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  portugal: 'Portugal',
  espanha: 'Spain', españa: 'Spain', espana: 'Spain', spain: 'Spain',
  irlanda: 'Ireland', ireland: 'Ireland',
  franca: 'France', frança: 'France', france: 'France',
  italia: 'Italy', itália: 'Italy', italy: 'Italy',
  alemanha: 'Germany', germany: 'Germany', deutschland: 'Germany',
  'reino unido': 'United Kingdom', uk: 'United Kingdom', 'united kingdom': 'United Kingdom',
  inglaterra: 'United Kingdom', england: 'United Kingdom',
  holanda: 'Netherlands', netherlands: 'Netherlands', 'paises baixos': 'Netherlands',
  belgica: 'Belgium', bélgica: 'Belgium', belgium: 'Belgium',
  suica: 'Switzerland', suíça: 'Switzerland', switzerland: 'Switzerland',
  austria: 'Austria', áustria: 'Austria',
  grecia: 'Greece', grécia: 'Greece', greece: 'Greece',
  marrocos: 'Morocco', marrocco: 'Morocco', morocco: 'Morocco',
  japao: 'Japan', japão: 'Japan', japan: 'Japan',
  'estados unidos': 'United States', eua: 'United States', usa: 'United States',
  'united states': 'United States',
  tailandia: 'Thailand', tailândia: 'Thailand', thailand: 'Thailand',
  peru: 'Peru',
  brasil: 'Brazil', brazil: 'Brazil',
  mexico: 'Mexico', méxico: 'Mexico',
  canada: 'Canada', canadá: 'Canada',
  vietname: 'Vietnam', vietna: 'Vietnam', vietnam: 'Vietnam',
};

/**
 * Offline city route per country — used by the `expansionMock` path and as the
 * last-resort fallback when the LLM is unavailable. Deliberately short and
 * generic (capital + 1-2 headline cities); the LLM path is what tailors the
 * route to the brief.
 */
const COUNTRY_CITY_FIXTURES: Record<string, string[]> = {
  Portugal: ['Lisbon', 'Porto', 'Sintra'],
  Spain: ['Madrid', 'Barcelona', 'Seville'],
  Ireland: ['Dublin', 'Galway', 'Cork'],
  France: ['Paris', 'Lyon', 'Nice'],
  Italy: ['Rome', 'Florence', 'Venice'],
  Germany: ['Berlin', 'Munich', 'Hamburg'],
  'United Kingdom': ['London', 'Edinburgh', 'Manchester'],
  Netherlands: ['Amsterdam', 'Rotterdam', 'Utrecht'],
  Belgium: ['Brussels', 'Bruges', 'Ghent'],
  Switzerland: ['Zurich', 'Lucerne', 'Geneva'],
  Austria: ['Vienna', 'Salzburg', 'Innsbruck'],
  Greece: ['Athens', 'Thessaloniki', 'Santorini'],
  Morocco: ['Marrakesh', 'Fez', 'Casablanca'],
  Japan: ['Tokyo', 'Kyoto', 'Osaka'],
  'United States': ['New York', 'San Francisco', 'Los Angeles'],
  Thailand: ['Bangkok', 'Chiang Mai', 'Phuket'],
  Peru: ['Lima', 'Cusco', 'Arequipa'],
  Brazil: ['Rio de Janeiro', 'São Paulo', 'Salvador'],
  Mexico: ['Mexico City', 'Oaxaca', 'Cancún'],
  Canada: ['Toronto', 'Vancouver', 'Montreal'],
  Vietnam: ['Hanoi', 'Ho Chi Minh City', 'Da Nang'],
};

function canonicalCountry(token: string): string | null {
  return COUNTRY_ALIASES[token.trim().toLowerCase()] ?? null;
}

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export class DestinationParser extends BaseService {
  private readonly expansionEnabled: boolean;
  private readonly expansionMock: boolean;

  // Optional LLM for country→cities expansion and cities-without-country extraction.
  constructor(private readonly ai?: IAIProvider, opts: DestinationParserOptions = {}) {
    super('destination-parser');
    this.expansionEnabled = opts.expansionEnabled ?? true;
    this.expansionMock = opts.expansionMock ?? false;
  }

  /**
   * Parse a free-text region into structured destinations with a nights split.
   * Heuristic first; then LLM expansion for bare countries; then LLM extraction
   * for cities that still lack a country; then best-effort fallbacks.
   */
  async parse(region: string, totalNights: number, opts: ParseOptions = {}): Promise<ParsedDestination[]> {
    const allowExpansion = opts.allowExpansion !== false;
    const heuristic = this.parseHeuristic(region);

    // Fully resolved by the heuristic — every entry has a real city and country.
    if (heuristic && heuristic.every((d) => d.city && d.country)) {
      return this.distributeNights(heuristic, totalNights);
    }

    // Read-only preview: hand back whatever the heuristic produced, including
    // bare-country markers (`{ city: '', country }`), without spending a token.
    if (!allowExpansion) {
      return this.distributeNights(
        heuristic ?? [{ city: titleCase(region), country: '', nights: 0 }],
        totalNights,
      );
    }

    const canExpand = this.expansionEnabled && (this.ai != null || this.expansionMock);
    const hasBareCountry = heuristic?.some((d) => d.country && !d.city) ?? false;
    if (hasBareCountry && canExpand) {
      try {
        const expanded = await this.expandCountriesToCities(heuristic!, totalNights, opts.brief);
        if (expanded.length > 0) return this.distributeNights(expanded, totalNights);
      } catch (err) {
        this.logger.warn('Country→cities expansion failed, using fallback', { error: String(err) });
      }
    }

    // Cities written by the user but with no country attached.
    const hasCitylessCity = heuristic?.some((d) => d.city && !d.country) ?? false;
    if (hasCitylessCity && this.ai) {
      try {
        const viaAI = await this.parseWithAI(region);
        if (viaAI.length > 0) return this.distributeNights(viaAI, totalNights);
      } catch (err) {
        this.logger.warn('Destination LLM parse failed, using heuristic', { error: String(err) });
      }
    }

    // Best-effort: keep the named cities; only if there are none, treat the
    // bare-country marker's country name as the place.
    if (heuristic && heuristic.length > 0) {
      const named = heuristic.filter((d) => d.city);
      const chosen = named.length > 0 ? named : heuristic.map((d) => ({ ...d, city: d.city || d.country }));
      return this.distributeNights(chosen, totalNights);
    }
    return this.distributeNights([{ city: titleCase(region), country: '', nights: 0 }], totalNights);
  }

  /**
   * Tokenise on `+` and `,`, classify each token as city or country, and attach
   * the country to all preceding cities up to it. A country token with no
   * preceding cities becomes a bare-country marker (`{ city: '', country }`) for
   * the caller to expand.
   * e.g. "comporta + mertola, portugal + barcelona, espanha + dublin, irlanda"
   *   → Comporta/PT, Mértola/PT, Barcelona/ES, Dublin/IE
   *      "japão" → { city: '', country: 'Japan' }
   */
  parseHeuristic(region: string): ParsedDestination[] | null {
    if (!region?.trim()) return null;

    const tokens = region.split(/[+,]/).map((t) => t.trim()).filter(Boolean);
    const destinations: ParsedDestination[] = [];
    let pendingCities: string[] = [];

    for (const token of tokens) {
      const country = canonicalCountry(token);
      if (country) {
        if (pendingCities.length === 0) {
          destinations.push({ city: '', country, nights: 0 });
        } else {
          for (const city of pendingCities) destinations.push({ city, country, nights: 0 });
          pendingCities = [];
        }
      } else {
        pendingCities.push(titleCase(token));
      }
    }
    // Trailing cities with no country — keep them so the caller can fall back.
    for (const city of pendingCities) destinations.push({ city, country: '', nights: 0 });

    return destinations.length > 0 ? destinations : null;
  }

  /**
   * Replace each bare-country marker with a real ordered city route. Named
   * cities in `entries` are kept in place; only markers (`country && !city`) are
   * expanded. Total city count is capped at `ceil(totalNights / 2)` (but never
   * below the number of original entries) so a short trip never explodes into a
   * dozen cities.
   */
  private async expandCountriesToCities(
    entries: ParsedDestination[],
    totalNights: number,
    brief?: DestinationBrief,
  ): Promise<ParsedDestination[]> {
    const maxCities = Math.max(entries.length, Math.ceil(totalNights / 2));
    const named = entries.filter((d) => d.city);
    const bareCountries = entries.filter((d) => d.country && !d.city).map((d) => d.country);

    const route =
      this.expansionMock || this.ai == null
        ? this.fixtureRoute(bareCountries)
        : await this.llmRoute(bareCountries, totalNights, maxCities, brief);

    // All entries were bare countries → the route IS the itinerary.
    if (named.length === 0) {
      return route.slice(0, maxCities).map((d) => ({ ...d, nights: 0 }));
    }

    // Mixed input: slot each country's cities where its marker sat.
    const byCountry = new Map<string, ParsedDestination[]>();
    for (const r of route) {
      const key = foldTerm(r.country);
      const bucket = byCountry.get(key) ?? [];
      bucket.push(r);
      byCountry.set(key, bucket);
    }
    const out: ParsedDestination[] = [];
    for (const d of entries) {
      if (d.city) {
        out.push({ ...d, nights: 0 });
        continue;
      }
      const slice = byCountry.get(foldTerm(d.country)) ?? [{ city: titleCase(d.country), country: d.country, nights: 0 }];
      out.push(...slice.map((r) => ({ ...r, nights: 0 })));
    }
    return out.slice(0, maxCities);
  }

  /** Static city route for a list of countries — mock path and offline fallback. */
  private fixtureRoute(countries: string[]): ParsedDestination[] {
    const out: ParsedDestination[] = [];
    for (const country of countries) {
      const canon = canonicalCountry(country) ?? titleCase(country);
      const cities = COUNTRY_CITY_FIXTURES[canon] ?? [titleCase(country)];
      for (const city of cities) out.push({ city, country: canon, nights: 0 });
    }
    return out;
  }

  private async llmRoute(
    countries: string[],
    totalNights: number,
    maxCities: number,
    brief?: DestinationBrief,
  ): Promise<ParsedDestination[]> {
    const briefLine = [
      brief?.groupSize ? `Group of ${brief.groupSize}.` : '',
      brief?.pace ? `Pace: ${brief.pace} (low = few stops, unhurried; high = packed, many stops).` : '',
      brief?.mustHaves?.length ? `Interests: ${brief.mustHaves.join(', ')}.` : '',
      brief?.avoids?.length ? `Avoid: ${brief.avoids.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const prompt =
      `Pick the cities to visit for a ${totalNights}-night trip covering: ${countries.join(', ')}. ` +
      (briefLine ? `${briefLine} ` : '') +
      'Respond with ONLY a JSON array of {"city": string, "country": string (English name)} in ' +
      `visiting order, minimising backtracking. At most ${maxCities} cities total, at least one per country.`;

    const { content } = await this.ai!.complete(
      'You plan a realistic city route for a country-level travel brief. Output JSON only.',
      [{ role: 'user', content: prompt }],
      { maxTokens: 512 },
    );
    const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const arr = JSON.parse(stripped) as Array<{ city?: string; country?: string }>;
    const clean = arr
      .filter((d): d is { city: string; country: string } => Boolean(d.city) && Boolean(d.country))
      .map((d) => ({ city: titleCase(d.city), country: titleCase(d.country), nights: 0 }));
    if (clean.length === 0) throw new Error('LLM returned no usable cities');
    return clean;
  }

  private async parseWithAI(region: string): Promise<ParsedDestination[]> {
    const prompt =
      'Extract the travel destinations from this free text. Respond with ONLY a JSON array of ' +
      '{"city": string, "country": string (English name)} in visiting order. ' +
      `Text: "${region}"`;
    const { content } = await this.ai!.complete(
      'You extract structured travel destinations from messy free text. Output JSON only.',
      [{ role: 'user', content: prompt }],
      { maxTokens: 512 },
    );
    const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const arr = JSON.parse(stripped) as Array<{ city?: string; country?: string }>;
    return arr
      .filter((d) => d.city)
      .map((d) => ({ city: titleCase(d.city as string), country: titleCase(d.country ?? ''), nights: 0 }));
  }

  /** Spread totalNights across destinations: even split, leftover nights to the first cities. */
  distributeNights(destinations: ParsedDestination[], totalNights: number): ParsedDestination[] {
    const n = destinations.length;
    if (n === 0) return [];
    const nights = Math.max(n, totalNights); // at least one night per city
    const base = Math.floor(nights / n);
    let remainder = nights - base * n;
    return destinations.map((d) => {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      return { ...d, nights: base + extra };
    });
  }
}
