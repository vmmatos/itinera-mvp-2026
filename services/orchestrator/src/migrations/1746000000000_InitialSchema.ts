import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1746000000000 implements MigrationInterface {
  name = 'InitialSchema1746000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"            UUID NOT NULL DEFAULT uuid_generate_v4(),
        "email"         VARCHAR(255) NOT NULL,
        "password_hash" VARCHAR(255) NOT NULL,
        "name"          VARCHAR(255) NOT NULL,
        "role"          VARCHAR(50) NOT NULL DEFAULT 'user',
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trips" (
        "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"            VARCHAR(255) NOT NULL,
        "status"          VARCHAR(50) NOT NULL DEFAULT 'draft',
        "owner_id"        UUID NOT NULL,
        "start_date"      DATE,
        "end_date"        DATE,
        "budget_total"    NUMERIC(12,2),
        "budget_currency" VARCHAR(10) NOT NULL DEFAULT 'EUR',
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trips" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trips_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "travellers" (
        "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "trip_id"     UUID NOT NULL,
        "user_id"     UUID NOT NULL,
        "preferences" JSONB NOT NULL DEFAULT '{}',
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_travellers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_travellers_trip_user" UNIQUE ("trip_id", "user_id"),
        CONSTRAINT "FK_travellers_trip" FOREIGN KEY ("trip_id")
          REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_travellers_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "proposals" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "trip_id"    UUID NOT NULL,
        "agent"      VARCHAR(100) NOT NULL,
        "round"      INTEGER NOT NULL,
        "content"    JSONB NOT NULL DEFAULT '{}',
        "score"      NUMERIC(5,2),
        "status"     VARCHAR(50) NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_proposals" PRIMARY KEY ("id"),
        CONSTRAINT "FK_proposals_trip" FOREIGN KEY ("trip_id")
          REFERENCES "trips"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_logs" (
        "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "trip_id"     UUID NOT NULL,
        "agent"       VARCHAR(100) NOT NULL,
        "round"       INTEGER NOT NULL,
        "action"      VARCHAR(100) NOT NULL,
        "latency_ms"  INTEGER,
        "tokens_used" INTEGER,
        "reasoning"   TEXT,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "satisfaction_scores" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "trip_id"    UUID NOT NULL,
        "user_id"    UUID NOT NULL,
        "score"      NUMERIC(3,1) NOT NULL,
        "feedback"   TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_satisfaction_scores" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sat_scores_trip" FOREIGN KEY ("trip_id")
          REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sat_scores_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attractions" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"       VARCHAR(255) NOT NULL,
        "location"   VARCHAR(255) NOT NULL,
        "category"   VARCHAR(100) NOT NULL,
        "metadata"   JSONB NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attractions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trip_metrics" (
        "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
        "trip_id"         UUID NOT NULL,
        "round"           INTEGER NOT NULL,
        "consensus_score" NUMERIC(5,2),
        "conflict_count"  INTEGER NOT NULL DEFAULT 0,
        "metadata"        JSONB NOT NULL DEFAULT '{}',
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_metrics" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_metrics_trip" FOREIGN KEY ("trip_id")
          REFERENCES "trips"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_trips_owner_id"       ON "trips"("owner_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_travellers_trip_id"   ON "travellers"("trip_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_travellers_user_id"   ON "travellers"("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_proposals_trip_id"    ON "proposals"("trip_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_proposals_agent"      ON "proposals"("agent")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_agent_logs_trip_id"   ON "agent_logs"("trip_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_agent_logs_agent"     ON "agent_logs"("agent")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_sat_scores_trip_id"   ON "satisfaction_scores"("trip_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_trip_metrics_trip_id" ON "trip_metrics"("trip_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "trip_metrics"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attractions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "satisfaction_scores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "proposals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "travellers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "trips"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
