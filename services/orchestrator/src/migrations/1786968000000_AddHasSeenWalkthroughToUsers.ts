import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHasSeenWalkthroughToUsers1786968000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS has_seen_walkthrough BOOLEAN NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS has_seen_walkthrough`);
  }
}
