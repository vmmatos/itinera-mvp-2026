.PHONY: dev infra up stop logs shell kong-config db-migrate db-seed test test-unit help

DC := docker compose \
	-f dev/docker-compose.yaml \
	--env-file dev/.dev.env \
	--env-file dev/.secrets.env

# Default target
.DEFAULT_GOAL := help

## Start all infrastructure, run DB migrations + seed, apply Kong config
dev:
	$(DC) up -d
	@echo "Waiting for PostgreSQL to be ready..."
	@until $(DC) exec -T postgres pg_isready -q 2>/dev/null; do sleep 1; done
	@$(MAKE) db-migrate
	@$(MAKE) db-seed
	@$(MAKE) kong-config

## Start postgres + redis + rabbitmq only (no Kong)
infra:
	$(DC) up -d postgres redis rabbitmq

## Start one service:  make up s=orchestrator
up:
	$(DC) up -d $(s)

## Stop one service:   make stop s=orchestrator
stop:
	$(DC) stop $(s)

## Tail logs:          make logs s=finance-agent
logs:
	$(DC) logs -f $(s)

## Open shell:         make shell s=postgres
shell:
	$(DC) exec $(s) sh

## Apply / reapply Kong routes and plugins (idempotent)
kong-config:
	@set -a && source dev/.dev.env && source dev/.secrets.env && set +a && \
		./infrastructure/kong/configure.sh

## Run TypeORM migrations (spins up a temporary orchestrator container)
db-migrate:
	$(DC) run --rm orchestrator npm run migration:run

## Seed test data (spins up a temporary orchestrator container)
db-seed:
	$(DC) run --rm orchestrator npm run seed

## Run tests — all or one service:  make test s=validator
test:
ifdef s
	$(DC) exec $(s) npm test
else
	@for svc in orchestrator preference-agent orchestrator-agent \
		finance-agent logistics-agent validator notification sharing ws-relay; do \
		echo "==> Testing $$svc"; \
		$(DC) exec $$svc npm test 2>/dev/null || echo "  (service not running, skip)"; \
	done
endif

## Unit tests only
test-unit:
	$(DC) run --rm orchestrator npm run test:unit

## Tear down all containers and volumes (destructive)
down:
	$(DC) down -v

## Show this help
help:
	@grep -E '^##' Makefile | sed 's/## //'
