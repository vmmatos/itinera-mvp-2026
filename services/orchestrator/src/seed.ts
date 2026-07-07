import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from '@/data-source';
import { User } from '@/entities/User';
import { Attraction } from '@/entities/Attraction';
import { createLogger } from '@itinera/shared';

const logger = createLogger('seed');

const SEED_USERS: Array<{ email: string; name: string; role: string; password: string }> = [
  {
    email: 'admin@itinera.dev',
    name: 'Admin',
    role: 'admin',
    password: process.env['SEED_ADMIN_PASSWORD'] ?? 'admin-dev-change-in-prod',
  },
  {
    email: 'alice@itinera.dev',
    name: 'Alice Vieira',
    role: 'user',
    password: process.env['SEED_USER_PASSWORD'] ?? 'alice-dev-change-in-prod',
  },
];

// Card #73 — real entry prices for common Portuguese attractions, so the
// finance agent's activities budget category can use real prices instead of
// a flat per-attraction estimate.
const SEED_ATTRACTIONS: Array<{ name: string; location: string; category: string; entryPrice: number | null }> = [
  { name: 'Pena Palace', location: 'Sintra', category: 'monument', entryPrice: 14 },
  { name: 'Quinta da Regaleira', location: 'Sintra', category: 'monument', entryPrice: 10 },
  { name: 'Mosteiro dos Jerónimos', location: 'Lisbon', category: 'monument', entryPrice: 10 },
  { name: 'Torre de Belém', location: 'Lisbon', category: 'monument', entryPrice: 6 },
  { name: 'Castelo de São Jorge', location: 'Lisbon', category: 'monument', entryPrice: 10 },
  { name: 'Alfama', location: 'Lisbon', category: 'neighbourhood', entryPrice: null },
];

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(User);

  for (const data of SEED_USERS) {
    const exists = await repo.findOneBy({ email: data.email });
    if (exists) {
      logger.info('skip existing user', { email: data.email });
      continue;
    }
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = repo.create({ email: data.email, name: data.name, role: data.role, passwordHash });
    await repo.save(user);
    logger.info('created user', { email: data.email, role: data.role });
  }

  const attractionRepo = AppDataSource.getRepository(Attraction);
  for (const data of SEED_ATTRACTIONS) {
    const exists = await attractionRepo.findOneBy({ name: data.name });
    if (exists) {
      logger.info('skip existing attraction', { name: data.name });
      continue;
    }
    const attraction = attractionRepo.create({
      name: data.name,
      location: data.location,
      category: data.category,
      entryPrice: data.entryPrice,
      entryPriceCurrency: 'EUR',
      metadata: {},
    });
    await attractionRepo.save(attraction);
    logger.info('created attraction', { name: data.name, entryPrice: data.entryPrice });
  }

  await AppDataSource.destroy();
}

seed().catch((err: unknown) => {
  logger.error('seed failed', { error: String(err) });
  process.exit(1);
});
