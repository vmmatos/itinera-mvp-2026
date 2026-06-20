export interface LocalRestriction {
  type: 'sunday_closure' | 'monday_closure';
  activityKeywords: string[];
  message: string;
}

export const LOCAL_RESTRICTIONS: Record<string, LocalRestriction[]> = {
  // Strict Sunday trading laws
  DE: [
    {
      type: 'sunday_closure',
      activityKeywords: ['shop', 'supermarket', 'store', 'mall', 'market', 'kaufhof', 'aldi', 'lidl', 'rewe', 'edeka', 'dm', 'drogerie', 'pharmacy', 'apotheke'],
      message: 'Most shops, supermarkets and stores are closed on Sundays in Germany (Ladenschlussgesetz).',
    },
  ],
  AT: [
    {
      type: 'sunday_closure',
      activityKeywords: ['shop', 'supermarket', 'store', 'mall', 'market', 'spar', 'billa', 'hofer', 'merkur', 'dm', 'drogerie'],
      message: 'Most shops and supermarkets are closed on Sundays in Austria.',
    },
  ],
  CH: [
    {
      type: 'sunday_closure',
      activityKeywords: ['shop', 'supermarket', 'store', 'mall', 'market', 'migros', 'coop', 'spar', 'manor', 'pharmacy', 'apotheke'],
      message: 'Most shops and supermarkets are closed on Sundays in Switzerland.',
    },
  ],

  // Monday closures common in restaurant/cultural sectors
  FR: [
    {
      type: 'monday_closure',
      activityKeywords: ['museum', 'musée', 'musee', 'gallery', 'galerie', 'restaurant', 'bistro', 'brasserie', 'café', 'cafe', 'louvre', 'orsay'],
      message: 'Many museums and restaurants are closed on Mondays in France.',
    },
  ],
  ES: [
    {
      type: 'monday_closure',
      activityKeywords: ['museum', 'museo', 'gallery', 'galería', 'galeria', 'restaurant', 'restaurante', 'bar', 'tapas'],
      message: 'Many museums and some restaurants are closed on Mondays in Spain.',
    },
  ],
  PT: [
    {
      type: 'monday_closure',
      activityKeywords: ['museum', 'museu', 'gallery', 'galeria', 'restaurant', 'restaurante', 'tasca', 'taberna', 'café', 'cafe'],
      message: 'Many museums and restaurants are closed on Mondays in Portugal.',
    },
  ],
};
