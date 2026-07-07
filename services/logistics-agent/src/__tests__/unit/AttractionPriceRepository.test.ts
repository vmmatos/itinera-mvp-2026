import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/data-source', () => ({
  AppDataSource: { getRepository: vi.fn() },
}));

import { AttractionPriceRepository } from '@/services/AttractionPriceRepository';
import { AppDataSource } from '@/data-source';

describe('AttractionPriceRepository', () => {
  let repo: AttractionPriceRepository;
  let mockWhere: ReturnType<typeof vi.fn>;
  let mockGetOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetOne = vi.fn();
    mockWhere = vi.fn().mockReturnValue({ getOne: mockGetOne });

    vi.mocked(AppDataSource.getRepository).mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue({ where: mockWhere }),
    } as never);

    repo = new AttractionPriceRepository();
  });

  it('returns the real entry price when the attraction is found', async () => {
    mockGetOne.mockResolvedValue({ name: 'Pena Palace', entryPrice: '14.00' });

    const result = await repo.findEntryPrice('Pena Palace');

    expect(result).toEqual({ entryPrice: 14, isEstimate: false, source: 'attraction_db' });
  });

  it('returns null when the attraction is not in the database', async () => {
    mockGetOne.mockResolvedValue(null);

    const result = await repo.findEntryPrice('Some Unknown Place');

    expect(result).toBeNull();
  });

  it('returns null when the attraction is found but has no entry price (e.g. free/neighbourhood)', async () => {
    mockGetOne.mockResolvedValue({ name: 'Alfama', entryPrice: null });

    const result = await repo.findEntryPrice('Alfama');

    expect(result).toBeNull();
  });

  it('matches case-insensitively via the query builder', async () => {
    mockGetOne.mockResolvedValue({ name: 'Pena Palace', entryPrice: '14.00' });

    await repo.findEntryPrice('pena palace');

    const [queryString, params] = mockWhere.mock.calls[0] as [string, { name: string }];
    expect(queryString).toContain('LOWER(a.name) = LOWER(:name)');
    expect(params.name).toBe('pena palace');
  });
});
