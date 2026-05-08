import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from '@/data-source';
import { User } from '@/entities/User';
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

  await AppDataSource.destroy();
}

seed().catch((err: unknown) => {
  logger.error('seed failed', { error: String(err) });
  process.exit(1);
});
