import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDateInputToTrips1750100000000 implements MigrationInterface {
  name = 'AddDateInputToTrips1750100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE trips ADD COLUMN IF NOT EXISTS date_input JSONB NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE trips DROP COLUMN IF EXISTS date_input`);
  }
}
