import { AppDataSource } from '@/data-source';
import { Attraction } from '@/entities/Attraction';

export interface AttractionPriceResult {
  entryPrice: number;
  isEstimate: boolean;
  source: string;
}

export class AttractionPriceRepository {
  async findEntryPrice(name: string): Promise<AttractionPriceResult | null> {
    const repo = AppDataSource.getRepository(Attraction);
    const match = await repo
      .createQueryBuilder('a')
      .where('LOWER(a.name) = LOWER(:name)', { name })
      .getOne();

    if (!match || match.entryPrice === null) return null;

    return {
      entryPrice: Number(match.entryPrice),
      isEstimate: false,
      source: 'attraction_db',
    };
  }
}
