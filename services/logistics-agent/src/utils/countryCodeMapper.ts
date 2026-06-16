const COUNTRY_NAME_MAP: Record<string, string> = {
  afghanistan: 'AF', albania: 'AL', algeria: 'DZ', andorra: 'AD', angola: 'AO',
  argentina: 'AR', armenia: 'AM', australia: 'AU', austria: 'AT', azerbaijan: 'AZ',
  bahrain: 'BH', bangladesh: 'BD', belarus: 'BY', belgium: 'BE', bolivia: 'BO',
  'bosnia and herzegovina': 'BA', brazil: 'BR', bulgaria: 'BG', cambodia: 'KH',
  cameroon: 'CM', canada: 'CA', chile: 'CL', china: 'CN', colombia: 'CO',
  'costa rica': 'CR', croatia: 'HR', cuba: 'CU', cyprus: 'CY',
  'czech republic': 'CZ', czechia: 'CZ', denmark: 'DK', ecuador: 'EC',
  egypt: 'EG', estonia: 'EE', ethiopia: 'ET', finland: 'FI', france: 'FR',
  georgia: 'GE', germany: 'DE', ghana: 'GH', greece: 'GR', guatemala: 'GT',
  honduras: 'HN', hungary: 'HU', iceland: 'IS', india: 'IN', indonesia: 'ID',
  iran: 'IR', iraq: 'IQ', ireland: 'IE', israel: 'IL', italy: 'IT',
  jamaica: 'JM', japan: 'JP', jordan: 'JO', kazakhstan: 'KZ', kenya: 'KE',
  'south korea': 'KR', korea: 'KR', kosovo: 'XK', kuwait: 'KW', latvia: 'LV',
  lebanon: 'LB', libya: 'LY', liechtenstein: 'LI', lithuania: 'LT',
  luxembourg: 'LU', malaysia: 'MY', malta: 'MT', mexico: 'MX', moldova: 'MD',
  monaco: 'MC', mongolia: 'MN', montenegro: 'ME', morocco: 'MA',
  'netherlands': 'NL', 'new zealand': 'NZ', nicaragua: 'NI', nigeria: 'NG',
  'north macedonia': 'MK', norway: 'NO', oman: 'OM', pakistan: 'PK',
  palestine: 'PS', panama: 'PA', paraguay: 'PY', peru: 'PE', philippines: 'PH',
  poland: 'PL', portugal: 'PT', qatar: 'QA', romania: 'RO', russia: 'RU',
  'saudi arabia': 'SA', senegal: 'SN', serbia: 'RS', singapore: 'SG',
  slovakia: 'SK', slovenia: 'SI', somalia: 'SO', 'south africa': 'ZA',
  spain: 'ES', 'sri lanka': 'LK', sweden: 'SE', switzerland: 'CH',
  syria: 'SY', taiwan: 'TW', tajikistan: 'TJ', tanzania: 'TZ', thailand: 'TH',
  tunisia: 'TN', turkey: 'TR', turkmenistan: 'TM', uganda: 'UG', ukraine: 'UA',
  'united arab emirates': 'AE', uae: 'AE', 'united kingdom': 'GB', uk: 'GB',
  'united states': 'US', usa: 'US', uruguay: 'UY', uzbekistan: 'UZ',
  venezuela: 'VE', vietnam: 'VN', yemen: 'YE', zambia: 'ZM', zimbabwe: 'ZW',
};

export function toCountryCode(region: string): string | null {
  const trimmed = region.trim();

  // If already a 2-letter ISO code
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;

  // Try last segment after comma: "Paris, France" → "France"
  const segments = trimmed.split(',').map((s) => s.trim());
  const candidates = [segments[segments.length - 1] ?? '', segments[0] ?? ''].filter(Boolean);

  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    const code = COUNTRY_NAME_MAP[key];
    if (code) return code;

    // Partial match: "Deutschland" isn't in map, but "germany" might cover typos
    for (const [name, iso] of Object.entries(COUNTRY_NAME_MAP)) {
      if (key.includes(name) || name.includes(key)) return iso;
    }
  }

  return null;
}
