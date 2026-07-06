import { BaseService } from '@itinera/shared';
import type { IAIProvider } from '@itinera/shared';

export interface ParsedDestination {
  city: string;
  country: string;
  nights: number;
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
  // Optional LLM fallback for strings the heuristic can't resolve.
  constructor(private readonly ai?: IAIProvider) {
    super('destination-parser');
  }

  /**
   * Parse a free-text region into structured destinations with a nights split.
   * Heuristic first; LLM fallback when the heuristic leaves cities without a country.
   */
  async parse(region: string, totalNights: number): Promise<ParsedDestination[]> {
    const heuristic = this.parseHeuristic(region);
    if (heuristic && heuristic.every((d) => d.country)) {
      return this.distributeNights(heuristic, totalNights);
    }

    if (this.ai) {
      try {
        const viaAI = await this.parseWithAI(region);
        if (viaAI.length > 0) return this.distributeNights(viaAI, totalNights);
      } catch (err) {
        this.logger.warn('Destination LLM parse failed, using heuristic', { error: String(err) });
      }
    }

    // Best-effort: heuristic with any missing country left blank, else single destination.
    if (heuristic && heuristic.length > 0) return this.distributeNights(heuristic, totalNights);
    return this.distributeNights([{ city: titleCase(region), country: '', nights: 0 }], totalNights);
  }

  /**
   * Tokenise on `+` and `,`, classify each token as city or country, and attach
   * the country to all preceding cities up to it.
   * e.g. "comporta + mertola, portugal + barcelona, espanha + dublin, irlanda"
   *   → Comporta/PT, Mértola/PT, Barcelona/ES, Dublin/IE
   */
  parseHeuristic(region: string): ParsedDestination[] | null {
    if (!region?.trim()) return null;

    const tokens = region.split(/[+,]/).map((t) => t.trim()).filter(Boolean);
    const destinations: ParsedDestination[] = [];
    let pendingCities: string[] = [];

    for (const token of tokens) {
      const country = canonicalCountry(token);
      if (country) {
        for (const city of pendingCities) destinations.push({ city, country, nights: 0 });
        pendingCities = [];
      } else {
        pendingCities.push(titleCase(token));
      }
    }
    // Trailing cities with no country — keep them so the caller can fall back.
    for (const city of pendingCities) destinations.push({ city, country: '', nights: 0 });

    return destinations.length > 0 ? destinations : null;
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
