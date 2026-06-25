import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransportPreferenceToTrips1750200000000 implements MigrationInterface {
  name = 'AddTransportPreferenceToTrips1750200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE trips ADD COLUMN IF NOT EXISTS transport_preference VARCHAR(10) NOT NULL DEFAULT 'best'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE trips DROP COLUMN IF EXISTS transport_preference`);
  }
}
