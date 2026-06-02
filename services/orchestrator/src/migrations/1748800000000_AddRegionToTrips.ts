import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRegionToTrips1748800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE trips
      ADD COLUMN IF NOT EXISTS region VARCHAR(255) NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE trips
      DROP COLUMN IF EXISTS region
    `);
  }
}
