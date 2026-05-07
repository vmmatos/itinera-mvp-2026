#!/usr/bin/env bash
# Creates the kong database and user in the same Postgres instance.
# Runs once on first container start (postgres entrypoint init dir).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE USER kong WITH PASSWORD '${KONG_PG_PASSWORD:-changeme_kong_dev}';
  CREATE DATABASE kong OWNER kong;
  GRANT ALL PRIVILEGES ON DATABASE kong TO kong;
EOSQL
