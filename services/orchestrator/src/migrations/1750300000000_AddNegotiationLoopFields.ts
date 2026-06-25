import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Card #79 — iterative negotiation loop persistence.
 *
 * - proposals.action / reasoning: per-round stance ('propose'|'refine'|'accept'|'reject').
 * - trip_metrics convergence fields: the measurable negotiation signal.
 * - trips.rejection_reason: why an impossible-budget trip was rejected.
 */
export class AddNegotiationLoopFields1750300000000 implements MigrationInterface {
  name = 'AddNegotiationLoopFields1750300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS action VARCHAR(50)`);
    await queryRunner.query(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reasoning TEXT`);

    await queryRunner.query(`ALTER TABLE trip_metrics ADD COLUMN IF NOT EXISTS convergence_rounds INTEGER`);
    await queryRunner.query(`ALTER TABLE trip_metrics ADD COLUMN IF NOT EXISTS forced_convergence BOOLEAN`);
    await queryRunner.query(`ALTER TABLE trip_metrics ADD COLUMN IF NOT EXISTS finance_block_count INTEGER`);
    await queryRunner.query(`ALTER TABLE trip_metrics ADD COLUMN IF NOT EXISTS logistics_block_count INTEGER`);
    await queryRunner.query(`ALTER TABLE trip_metrics ADD COLUMN IF NOT EXISTS total_tokens_used INTEGER`);
    await queryRunner.query(`ALTER TABLE trip_metrics ADD COLUMN IF NOT EXISTS total_time_ms INTEGER`);

    await queryRunner.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE trips DROP COLUMN IF EXISTS rejection_reason`);

    await queryRunner.query(`ALTER TABLE trip_metrics DROP COLUMN IF EXISTS total_time_ms`);
    await queryRunner.query(`ALTER TABLE trip_metrics DROP COLUMN IF EXISTS total_tokens_used`);
    await queryRunner.query(`ALTER TABLE trip_metrics DROP COLUMN IF EXISTS logistics_block_count`);
    await queryRunner.query(`ALTER TABLE trip_metrics DROP COLUMN IF EXISTS finance_block_count`);
    await queryRunner.query(`ALTER TABLE trip_metrics DROP COLUMN IF EXISTS forced_convergence`);
    await queryRunner.query(`ALTER TABLE trip_metrics DROP COLUMN IF EXISTS convergence_rounds`);

    await queryRunner.query(`ALTER TABLE proposals DROP COLUMN IF EXISTS reasoning`);
    await queryRunner.query(`ALTER TABLE proposals DROP COLUMN IF EXISTS action`);
  }
}
