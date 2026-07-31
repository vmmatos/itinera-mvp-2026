import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLanguageToUsers1785507754000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'en'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS language
    `);
  }
}
