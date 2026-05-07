import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from '@/data-source';
import { User } from '@/entities/User';

const SEED_USERS: Array<{ email: string; name: string; role: string; password: string }> = [
  { email: 'admin@itinera.dev', name: 'Admin',        role: 'admin', password: 'admin-secret-123' },
  { email: 'alice@itinera.dev', name: 'Alice Vieira', role: 'user',  password: 'alice-secret-123' },
];

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(User);

  for (const data of SEED_USERS) {
    const exists = await repo.findOneBy({ email: data.email });
    if (exists) {
      console.info(`[seed] skip existing user: ${data.email}`);
      continue;
    }
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = repo.create({ email: data.email, name: data.name, role: data.role, passwordHash });
    await repo.save(user);
    console.info(`[seed] created user: ${data.email} (${data.role})`);
  }

  await AppDataSource.destroy();
}

seed().catch((err: unknown) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
