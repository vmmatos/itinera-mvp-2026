-- Itinera application schema
-- Executed by PostgreSQL on first container start (docker-entrypoint-initdb.d)
-- TypeORM migrations are the source of truth for schema changes after initial setup

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'user',
  language      VARCHAR(10)  NOT NULL DEFAULT 'en',
  has_seen_walkthrough BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 VARCHAR(255)   NOT NULL,
  status               VARCHAR(50)    NOT NULL DEFAULT 'draft',
  region               VARCHAR(255),
  destinations         JSONB          NOT NULL DEFAULT '[]',
  owner_id             UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date           DATE,
  end_date             DATE,
  budget_total         NUMERIC(12,2),
  budget_currency      VARCHAR(10)    NOT NULL DEFAULT 'EUR',
  -- Trip-level group brief: pace / must-haves / avoids (1752000000000).
  preferences          JSONB          NOT NULL DEFAULT '{}',
  date_input           JSONB,
  transport_preference VARCHAR(10)    NOT NULL DEFAULT 'best',
  rejection_reason     TEXT,
  workflow_state       VARCHAR(50),
  workflow_context     JSONB,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- travellers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS travellers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id     UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  -- Nullable since 1748800000001: co-travellers have no account.
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255),
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, user_id)
);

-- ---------------------------------------------------------------------------
-- proposals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proposals (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id    UUID         NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  agent      VARCHAR(100) NOT NULL,
  round      INTEGER      NOT NULL,
  content    JSONB        NOT NULL DEFAULT '{}',
  score      NUMERIC(5,2),
  status     VARCHAR(50)  NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- agent_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id     UUID         NOT NULL,
  agent       VARCHAR(100) NOT NULL,
  round       INTEGER      NOT NULL,
  action      VARCHAR(100) NOT NULL,
  latency_ms  INTEGER,
  tokens_used INTEGER,
  reasoning   TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- satisfaction_scores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS satisfaction_scores (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id    UUID         NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score      NUMERIC(3,1) NOT NULL,
  feedback   TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- attractions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attractions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(255) NOT NULL,
  location   VARCHAR(255) NOT NULL,
  category   VARCHAR(100) NOT NULL,
  metadata   JSONB        NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- trip_metrics
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_metrics (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id          UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  round            INTEGER     NOT NULL,
  consensus_score  NUMERIC(5,2),
  conflict_count   INTEGER     NOT NULL DEFAULT 0,
  metadata         JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_trips_owner_id       ON trips(owner_id);
CREATE INDEX IF NOT EXISTS idx_travellers_trip_id   ON travellers(trip_id);
CREATE INDEX IF NOT EXISTS idx_travellers_user_id   ON travellers(user_id);
CREATE INDEX IF NOT EXISTS idx_proposals_trip_id    ON proposals(trip_id);
CREATE INDEX IF NOT EXISTS idx_proposals_agent       ON proposals(agent);
CREATE INDEX IF NOT EXISTS idx_agent_logs_trip_id   ON agent_logs(trip_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent      ON agent_logs(agent);
CREATE INDEX IF NOT EXISTS idx_sat_scores_trip_id   ON satisfaction_scores(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_metrics_trip_id ON trip_metrics(trip_id);
