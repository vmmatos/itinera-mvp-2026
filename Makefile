.PHONY: dev infra up stop logs shell kong-config build-shared db-migrate db-seed test test-unit test-local test-scenarios test-smoke flush-transport-cache help

DC := docker compose \
	-f dev/docker-compose.yaml \
	--env-file dev/.dev.env \
	--env-file dev/.secrets.env

# Default target
.DEFAULT_GOAL := help

## Start all infrastructure, run DB migrations + seed, apply Kong config
dev: build-shared
	$(DC) --profile services up -d
	@echo "Waiting for PostgreSQL to be ready..."
	@until docker inspect --format='{{.State.Health.Status}}' itinera-postgres-db 2>/dev/null | grep -q healthy; do sleep 2; done
	@$(MAKE) db-migrate
	@$(MAKE) db-seed
	@$(MAKE) kong-config

## Start postgres + redis + rabbitmq only (no Kong)
infra:
	$(DC) up -d postgres redis rabbitmq

## Start one service:  make up s=orchestrator
up: build-shared
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

## Build @itinera/shared on the host (every service bind-mounts services/shared/dist read-only;
## on a fresh clone that dir doesn't exist yet, so Docker mounts it empty and breaks all services)
build-shared:
	yarn install
	yarn workspace @itinera/shared build

## Run TypeORM migrations (spins up a temporary orchestrator container)
db-migrate: build-shared
	$(DC) run --rm orchestrator yarn migration:run

## Seed test data (spins up a temporary orchestrator container)
db-seed: build-shared
	$(DC) run --rm orchestrator yarn seed

## Run tests — all or one service:  make test s=validator
test:
ifdef s
	$(DC) exec $(s) yarn test
else
	@for svc in auth orchestrator preference-agent orchestrator-agent \
		finance-agent logistics-agent validator notification sharing ws-relay; do \
		echo "==> Testing $$svc"; \
		$(DC) exec $$svc yarn test 2>/dev/null || echo "  (service not running, skip)"; \
	done
endif

## Unit tests only (Docker)
test-unit: build-shared
	$(DC) run --rm orchestrator yarn test:unit

## Run tests locally without Docker — all or one service:  make test-local s=preference-agent
test-local:
ifdef s
	cd services/$(s) && yarn test
else
	@for svc in auth orchestrator preference-agent orchestrator-agent \
		finance-agent logistics-agent validator notification sharing ws-relay; do \
		if [ -f "services/$$svc/package.json" ]; then \
			echo "==> Testing $$svc"; \
			(cd services/$$svc && yarn test) || echo "  ($$svc tests failed)"; \
		fi; \
	done
endif

## Run scenario tests locally
test-scenarios:
	cd tests/scenarios && yarn test

## Run smoke tests against live services (requires make dev)
test-smoke:
	cd tests/smoke && yarn test

## Flush Redis transport cache (run after deploying TransportService fixes)
flush-transport-cache:
	$(DC) exec redis sh -c 'redis-cli --scan --pattern "transport:*" | xargs -r redis-cli DEL'

## Tear down all containers and volumes (destructive)
down:
	$(DC) down -v

## Show this help
help:
	@grep -E '^##' Makefile | sed 's/## //'
