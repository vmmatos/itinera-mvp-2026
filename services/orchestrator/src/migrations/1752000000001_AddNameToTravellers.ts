import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Traveller display name. The form has always sent it; the API schema stripped
 * it, so per-traveller output (scores, PDF, notifications) had nothing to label
 * a row with. Nullable: co-travellers may be added without one.
 */
export class AddNameToTravellers1752000000001 implements MigrationInterface {
  name = 'AddNameToTravellers1752000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE travellers ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE travellers DROP COLUMN IF EXISTS name`);
  }
}
