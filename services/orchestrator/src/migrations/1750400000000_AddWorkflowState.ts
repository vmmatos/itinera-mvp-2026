import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowState1750400000000 implements MigrationInterface {
  name = 'AddWorkflowState1750400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE trips ADD COLUMN IF NOT EXISTS workflow_state VARCHAR(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE trips ADD COLUMN IF NOT EXISTS workflow_context JSONB`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE trips DROP COLUMN IF EXISTS workflow_context`);
    await queryRunner.query(`ALTER TABLE trips DROP COLUMN IF EXISTS workflow_state`);
  }
}
