import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NullableTravellerUserId1748800000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Drop FK and NOT NULL so guest travellers (no account) are supported
    await queryRunner.query(`ALTER TABLE travellers DROP CONSTRAINT IF EXISTS "travellers_user_id_fkey"`);
    await queryRunner.query(`ALTER TABLE travellers ALTER COLUMN user_id DROP NOT NULL`);
    // Drop full unique constraint; replace with partial index (excludes NULLs)
    await queryRunner.query(`ALTER TABLE travellers DROP CONSTRAINT IF EXISTS "UQ_travellers_tripId_userId"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_travellers_trip_user
      ON travellers(trip_id, user_id)
      WHERE user_id IS NOT NULL
    `);
    // Re-add FK as nullable
    await queryRunner.query(`
      ALTER TABLE travellers
      ADD CONSTRAINT travellers_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_travellers_trip_user`);
    await queryRunner.query(`ALTER TABLE travellers DROP CONSTRAINT IF EXISTS "travellers_user_id_fkey"`);
    await queryRunner.query(`ALTER TABLE travellers ALTER COLUMN user_id SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE travellers
      ADD CONSTRAINT travellers_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE travellers
      ADD CONSTRAINT "UQ_travellers_tripId_userId" UNIQUE(trip_id, user_id)
    `);
  }
}
