#!/usr/bin/env bash
# Creates the kong database and user in the same Postgres instance.
# Runs once on first container start (postgres entrypoint init dir).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'kong') THEN
      CREATE USER kong WITH PASSWORD '${KONG_PG_PASSWORD:-changeme_kong_dev}';
    END IF;
  END
  \$\$;

  SELECT 'CREATE DATABASE kong OWNER kong'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kong')\gexec

  GRANT ALL PRIVILEGES ON DATABASE kong TO kong;
EOSQL
