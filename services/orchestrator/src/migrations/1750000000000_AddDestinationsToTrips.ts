import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDestinationsToTrips1750000000000 implements MigrationInterface {
  name = 'AddDestinationsToTrips1750000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE trips
      ADD COLUMN IF NOT EXISTS destinations JSONB NOT NULL DEFAULT '[]'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE trips DROP COLUMN IF EXISTS destinations`);
  }
}
