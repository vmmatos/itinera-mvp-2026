import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Card #73 — real entry-price data for attractions (activities budget category).
 */
export class AddEntryPriceToAttractions1751000000000 implements MigrationInterface {
  name = 'AddEntryPriceToAttractions1751000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE attractions ADD COLUMN IF NOT EXISTS entry_price NUMERIC(6,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE attractions ADD COLUMN IF NOT EXISTS entry_price_currency VARCHAR(3) NOT NULL DEFAULT 'EUR'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE attractions DROP COLUMN IF EXISTS entry_price_currency`);
    await queryRunner.query(`ALTER TABLE attractions DROP COLUMN IF EXISTS entry_price`);
  }
}
