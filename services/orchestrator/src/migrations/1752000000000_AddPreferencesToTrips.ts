import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trip-level home for the group brief (pace / must-haves / avoids).
 *
 * The UI collects it once but used to copy it into every traveller's
 * preferences blob. Existing rows are deliberately not backfilled —
 * `resolveGroupPreferences` falls back to the per-traveller copies.
 */
export class AddPreferencesToTrips1752000000000 implements MigrationInterface {
  name = 'AddPreferencesToTrips1752000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE trips ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE trips DROP COLUMN IF EXISTS preferences`);
  }
}
