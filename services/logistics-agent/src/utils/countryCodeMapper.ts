const COUNTRY_NAME_MAP: Record<string, string> = {
  // ── English ──────────────────────────────────────────────────────────────
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
  netherlands: 'NL', 'new zealand': 'NZ', nicaragua: 'NI', nigeria: 'NG',
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

  // ── Portuguese ───────────────────────────────────────────────────────────
  'franca': 'FR', 'frança': 'FR', 'alemanha': 'DE', 'espanha': 'ES',
  'italia': 'IT', 'itália': 'IT', 'austria': 'AT', 'áustria': 'AT',
  'suica': 'CH', 'suíça': 'CH', 'belgica': 'BE', 'bélgica': 'BE',
  'holanda': 'NL', 'paises baixos': 'NL', 'países baixos': 'NL',
  'reino unido': 'GB', 'grecia': 'GR', 'grécia': 'GR', 'polonia': 'PL',
  'polónia': 'PL', 'republica checa': 'CZ', 'república checa': 'CZ',
  'dinamarca': 'DK', 'noruega': 'NO', 'suecia': 'SE', 'suécia': 'SE',
  'finlandia': 'FI', 'finlândia': 'FI', 'irlanda': 'IE', 'croacia': 'HR',
  'croácia': 'HR', 'romenia': 'RO', 'roménia': 'RO', 'hungria': 'HU',
  'eslovaquia': 'SK', 'eslováquia': 'SK', 'eslovenia': 'SI', 'eslovénia': 'SI',
  'luxemburgo': 'LU', 'islandia': 'IS', 'islândia': 'IS',
  'estados unidos': 'US', 'japao': 'JP', 'japão': 'JP', 'china': 'CN',
  'india': 'IN', 'índia': 'IN', 'marrocos': 'MA', 'egipto': 'EG',
  'turquia': 'TR', 'russia': 'RU', 'rússia': 'RU', 'brasil': 'BR',
  'mexico': 'MX', 'méxico': 'MX', 'canada': 'CA', 'canadá': 'CA',
  'australia': 'AU', 'austrália': 'AU',

  // ── French ───────────────────────────────────────────────────────────────
  'allemagne': 'DE', 'espagne': 'ES', 'italie': 'IT', 'autriche': 'AT',
  'suisse': 'CH', 'belgique': 'BE', 'pays-bas': 'NL', 'royaume-uni': 'GB',
  'grece': 'GR', 'grèce': 'GR', 'pologne': 'PL', 'republique tcheque': 'CZ',
  'republique tchèque': 'CZ', 'danemark': 'DK', 'danemark': 'DK',
  'norvege': 'NO', 'norvège': 'NO', 'suede': 'SE', 'suède': 'SE',
  'finlande': 'FI', 'irlande': 'IE', 'croatie': 'HR', 'roumanie': 'RO',
  'hongrie': 'HU', 'etats-unis': 'US', 'états-unis': 'US', 'japon': 'JP',
  'maroc': 'MA', 'turquie': 'TR', 'russie': 'RU', 'bresil': 'BR',
  'brésil': 'BR', 'mexique': 'MX', 'australie': 'AU',

  // ── Spanish ──────────────────────────────────────────────────────────────
  'francia': 'FR', 'alemania': 'DE', 'italia': 'IT', 'paises bajos': 'NL',
  'países bajos': 'NL', 'reino unido': 'GB', 'grecia': 'GR', 'polonia': 'PL',
  'republica checa': 'CZ', 'república checa': 'CZ', 'dinamarca': 'DK',
  'noruega': 'NO', 'suecia': 'SE', 'finlandia': 'FI', 'irlanda': 'IE',
  'croacia': 'HR', 'rumania': 'RO', 'hungria': 'HU', 'eslovaquia': 'SK',
  'eslovenia': 'SI', 'estados unidos': 'US', 'turquia': 'TR',
  'rusia': 'RU', 'brasil': 'BR', 'mejico': 'MX', 'marruecos': 'MA',

  // ── German ───────────────────────────────────────────────────────────────
  'frankreich': 'FR', 'deutschland': 'DE', 'spanien': 'ES', 'italien': 'IT',
  'osterreich': 'AT', 'österreich': 'AT', 'schweiz': 'CH', 'belgien': 'BE',
  'niederlande': 'NL', 'vereinigtes konigreich': 'GB', 'griechenland': 'GR',
  'danemark': 'DK', 'dänemark': 'DK', 'norwegen': 'NO', 'schweden': 'SE',
  'finnland': 'FI', 'irland': 'IE', 'kroatien': 'HR', 'rumanien': 'RO',
  'rumänien': 'RO', 'ungarn': 'HU', 'vereinigte staaten': 'US', 'japan': 'JP',
  'russland': 'RU', 'marokko': 'MA', 'turkei': 'TR', 'türkei': 'TR',
  'brasilien': 'BR',
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
