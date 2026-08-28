import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThemeToUsers1787000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS theme VARCHAR(10) NOT NULL DEFAULT 'dark'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS theme
    `);
  }
}
