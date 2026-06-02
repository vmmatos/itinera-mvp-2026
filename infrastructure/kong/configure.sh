#!/usr/bin/env bash
set -euo pipefail

KONG_ADMIN="${KONG_ADMIN_URL:-http://localhost:8001}"
CORS_ORIGINS="${CORS_ALLOWED_ORIGINS:-http://localhost:3000}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

wait_for_kong() {
  local retries=30 delay=2
  echo "Waiting for Kong Admin API at ${KONG_ADMIN}..."
  for i in $(seq 1 $retries); do
    if curl -sf "${KONG_ADMIN}/status" > /dev/null 2>&1; then
      echo "Kong is ready."
      return 0
    fi
    echo "  attempt $i/$retries — retrying in ${delay}s..."
    sleep "$delay"
  done
  echo "ERROR: Kong did not become ready in $((retries * delay))s" >&2
  exit 1
}

# Idempotent upsert via PUT /services/{name}
upsert_service() {
  local name=$1 url=$2
  curl -sf -X PUT "${KONG_ADMIN}/services/${name}" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${name}\",\"url\":\"${url}\"}" \
    > /dev/null
  echo "  service: ${name} -> ${url}"
}

# Idempotent upsert via PUT /routes/{name}
upsert_route() {
  local name=$1 service=$2
  shift 2
  # Remaining args are key=value pairs for the JSON body
  local json="{\"name\":\"${name}\",\"service\":{\"name\":\"${service}\"}"
  for kv in "$@"; do
    local key="${kv%%=*}"
    local val="${kv#*=}"
    json="${json},\"${key}\":${val}"
  done
  json="${json}}"
  curl -sf -X PUT "${KONG_ADMIN}/routes/${name}" \
    -H "Content-Type: application/json" \
    -d "$json" \
    > /dev/null
  echo "  route: ${name}"
}

# Ensure a plugin exists on a target (global, service, or route).
# Idempotent: checks by target + plugin name before creating.
ensure_plugin() {
  local target_type=$1  # "global", "service", "route"
  local target_name=$2  # ignored when global
  local plugin_name=$3
  local config_json=$4

  local list_url
  case "$target_type" in
    global)   list_url="${KONG_ADMIN}/plugins" ;;
    service)  list_url="${KONG_ADMIN}/services/${target_name}/plugins" ;;
    route)    list_url="${KONG_ADMIN}/routes/${target_name}/plugins" ;;
    consumer) list_url="${KONG_ADMIN}/consumers/${target_name}/plugins" ;;
  esac

  local existing
  existing=$(curl -sf "${list_url}" | \
    python3 -c "
import sys,json
d=json.load(sys.stdin)
matched=[x for x in d['data'] if x['name']=='${plugin_name}']
print(matched[0]['id'] if matched else '')
" 2>/dev/null || echo "")

  local body="{\"name\":\"${plugin_name}\",\"config\":${config_json}}"

  if [ -n "$existing" ]; then
    # Update existing plugin config
    curl -sf -X PATCH "${KONG_ADMIN}/plugins/${existing}" \
      -H "Content-Type: application/json" \
      -d "$body" > /dev/null
    echo "  plugin updated: ${plugin_name} on ${target_type}${target_name:+/$target_name}"
  else
    local post_url
    case "$target_type" in
      global)   post_url="${KONG_ADMIN}/plugins" ;;
      service)  post_url="${KONG_ADMIN}/services/${target_name}/plugins" ;;
      route)    post_url="${KONG_ADMIN}/routes/${target_name}/plugins" ;;
      consumer) post_url="${KONG_ADMIN}/consumers/${target_name}/plugins" ;;
    esac
    curl -sf -X POST "$post_url" \
      -H "Content-Type: application/json" \
      -d "$body" > /dev/null
    echo "  plugin created: ${plugin_name} on ${target_type}${target_name:+/$target_name}"
  fi
}

# Idempotent upsert via PUT /consumers/{username}
ensure_consumer() {
  local username=$1
  curl -sf -X PUT "${KONG_ADMIN}/consumers/${username}" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${username}\"}" \
    > /dev/null
  echo "  consumer: ${username}"
}

# Ensure JWT credential exists for consumer (idempotent by key)
ensure_jwt_cred() {
  local consumer=$1 key=$2 secret=$3
  local existing
  existing=$(curl -sf "${KONG_ADMIN}/consumers/${consumer}/jwt" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); \
      matched=[x for x in d['data'] if x['key']=='${key}']; \
      print(matched[0]['id'] if matched else '')" 2>/dev/null || echo "")

  if [ -z "$existing" ]; then
    curl -sf -X POST "${KONG_ADMIN}/consumers/${consumer}/jwt" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"${key}\",\"secret\":\"${secret}\",\"algorithm\":\"HS256\"}" \
      > /dev/null
    echo "  jwt credential created: ${key} for ${consumer}"
  else
    echo "  jwt credential exists: ${key} for ${consumer}"
  fi
}

# Ensure consumer belongs to ACL group (idempotent)
ensure_acl() {
  local consumer=$1 group=$2
  local existing
  existing=$(curl -sf "${KONG_ADMIN}/consumers/${consumer}/acls" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); \
      matched=[x for x in d['data'] if x['group']=='${group}']; \
      print('yes' if matched else '')" 2>/dev/null || echo "")

  if [ -z "$existing" ]; then
    curl -sf -X POST "${KONG_ADMIN}/consumers/${consumer}/acls" \
      -H "Content-Type: application/json" \
      -d "{\"group\":\"${group}\"}" \
      > /dev/null
    echo "  acl group: ${consumer} -> ${group}"
  else
    echo "  acl group exists: ${consumer} -> ${group}"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

wait_for_kong

# ---------------------------------------------------------------------------
# Services + Routes
# ---------------------------------------------------------------------------
echo ""
echo "==> Registering services and routes..."

# register_service <name> <upstream_url> <route_path> [ws]
register_service() {
  local name=$1 url=$2 path=$3 is_ws=${4:-}
  upsert_service "$name" "$url"

  if [ -n "$is_ws" ]; then
    # WebSocket proxied transparently on http/https — no ws/wss protocol override needed in Kong 3.x OSS
    upsert_route "${name}-api" "$name" \
      "paths=[\"${path}\"]" \
      "strip_path=false"
    # Ensure strip_path is false (PUT may default to true; PATCH enforces it)
    curl -sf -X PATCH "${KONG_ADMIN}/routes/${name}-api" \
      -H "Content-Type: application/json" \
      -d '{"strip_path":false}' > /dev/null
  else
    upsert_route "${name}-api" "$name" \
      "paths=[\"${path}\"]" \
      "strip_path=true"
  fi

  # Health + ready: public (no JWT/ACL). strip_path=false + request-transformer
  # rewrites the full path so upstream receives /health or /ready.
  upsert_route "${name}-health" "$name" \
    "paths=[\"${path}/health\"]" \
    "strip_path=false"
  ensure_plugin route "${name}-health" request-transformer \
    '{"replace":{"uri":"/health"}}'

  upsert_route "${name}-ready" "$name" \
    "paths=[\"${path}/ready\"]" \
    "strip_path=false"
  ensure_plugin route "${name}-ready" request-transformer \
    '{"replace":{"uri":"/ready"}}'
}

register_service auth                http://auth:3010                /api/auth
register_service orchestrator        http://orchestrator:3001        /api/orchestrator

# Public REST API surface: /api/v1 → orchestrator (strip_path=false so /api/v1/trips reaches upstream)
upsert_route "orchestrator-v1-api" "orchestrator" \
  "paths=[\"/api/v1\"]" \
  "strip_path=false"
register_service preference-agent    http://preference-agent:3002    /api/preferences
register_service orchestrator-agent  http://orchestrator-agent:3003  /api/consensus
register_service finance-agent       http://finance-agent:3004       /api/finance
register_service logistics-agent     http://logistics-agent:3005     /api/logistics
register_service validator           http://validator:3006           /api/validate
register_service notification        http://notification:3007        /api/notifications
register_service sharing             http://sharing:3008             /api/share
register_service ws-relay            http://ws-relay:3009            /stream           ws

# ---------------------------------------------------------------------------
# Global plugins
# ---------------------------------------------------------------------------
echo ""
echo "==> Configuring global plugins..."

# Correlation ID — inject X-Request-ID on every request
ensure_plugin global "" correlation-id \
  '{"header_name":"X-Request-ID","generator":"uuid#counter","echo_downstream":true}'

# Rate limiting — 100 req/min per consumer, local policy (per-node, sufficient for dev)
ensure_plugin global "" rate-limiting \
  '{"minute":100,"policy":"local","limit_by":"consumer","fault_tolerant":true,"hide_client_headers":false}'

# CORS — allow frontend origin
ensure_plugin global "" cors \
  "{\"origins\":[\"${CORS_ORIGINS}\"],\"methods\":[\"GET\",\"POST\",\"PUT\",\"PATCH\",\"DELETE\",\"OPTIONS\"],\"headers\":[\"Authorization\",\"Content-Type\",\"X-Request-ID\"],\"credentials\":true,\"max_age\":3600}"

# ---------------------------------------------------------------------------
# Per-route plugins: JWT + ACL on all API routes (not health routes)
# ---------------------------------------------------------------------------
echo ""
echo "==> Configuring per-route JWT and ACL plugins..."

for svc in \
  orchestrator preference-agent orchestrator-agent \
  finance-agent logistics-agent validator \
  notification sharing ws-relay; do

  ensure_plugin route "${svc}-api" jwt \
    '{"key_claim_name":"iss"}'

  ensure_plugin route "${svc}-api" acl \
    '{"allow":["user","admin","service"],"hide_groups_header":true}'
done

# orchestrator-v1-api: same JWT + ACL as orchestrator-api
ensure_plugin route "orchestrator-v1-api" jwt \
  '{"key_claim_name":"iss"}'
ensure_plugin route "orchestrator-v1-api" acl \
  '{"allow":["user","admin","service"],"hide_groups_header":true}'

# auth-api is intentionally excluded — login/register/oauth2 are public endpoints

# ---------------------------------------------------------------------------
# Consumers + credentials
# ---------------------------------------------------------------------------
echo ""
echo "==> Configuring consumers..."

# Validate required env vars
: "${JWT_SECRET:?JWT_SECRET not set in .secrets.env}"
: "${JWT_CONSUMER_KEY:?JWT_CONSUMER_KEY not set}"
: "${DEV_JWT_KEY_USER:?DEV_JWT_KEY_USER not set in .secrets.env}"
: "${DEV_JWT_SECRET_USER:?DEV_JWT_SECRET_USER not set in .secrets.env}"
: "${DEV_JWT_KEY_ADMIN:?DEV_JWT_KEY_ADMIN not set in .secrets.env}"
: "${DEV_JWT_SECRET_ADMIN:?DEV_JWT_SECRET_ADMIN not set in .secrets.env}"
: "${DEV_JWT_KEY_SERVICE:?DEV_JWT_KEY_SERVICE not set in .secrets.env}"
: "${DEV_JWT_SECRET_SERVICE:?DEV_JWT_SECRET_SERVICE not set in .secrets.env}"

# Consumer for auth-service-issued tokens (iss=JWT_CONSUMER_KEY)
ensure_consumer "itinera-app"
ensure_jwt_cred "itinera-app" "${JWT_CONSUMER_KEY}" "${JWT_SECRET}"
ensure_acl "itinera-app" "user"
ensure_acl "itinera-app" "admin"
ensure_plugin consumer "itinera-app" rate-limiting \
  '{"minute":200,"policy":"local","fault_tolerant":true}'

ensure_consumer "dev-user"
ensure_jwt_cred "dev-user" "$DEV_JWT_KEY_USER" "$DEV_JWT_SECRET_USER"
ensure_acl "dev-user" "user"

ensure_consumer "dev-admin"
ensure_jwt_cred "dev-admin" "$DEV_JWT_KEY_ADMIN" "$DEV_JWT_SECRET_ADMIN"
ensure_acl "dev-admin" "admin"
ensure_acl "dev-admin" "user"

ensure_consumer "dev-service"
ensure_jwt_cred "dev-service" "$DEV_JWT_KEY_SERVICE" "$DEV_JWT_SECRET_SERVICE"
ensure_acl "dev-service" "service"

# Higher rate limit tier for admin + service consumers
ensure_plugin consumer "dev-admin" rate-limiting \
  '{"minute":1000,"policy":"local","fault_tolerant":true}'
ensure_plugin consumer "dev-service" rate-limiting \
  '{"minute":1000,"policy":"local","fault_tolerant":true}'

# ---------------------------------------------------------------------------
echo ""
echo "Kong configured successfully."
echo ""
echo "Dev JWT tokens (for testing):"
echo "  User:    iss=${DEV_JWT_KEY_USER}"
echo "  Admin:   iss=${DEV_JWT_KEY_ADMIN}"
echo "  Service: iss=${DEV_JWT_KEY_SERVICE}"
echo ""
echo "  Generate token: node -e \"const j=require('jsonwebtoken'); console.log(j.sign({iss:'KEY'},'SECRET',{expiresIn:'8h'}))\""
