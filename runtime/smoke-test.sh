#!/usr/bin/env bash
# Unpacks a runtime bundle into a temporary directory and starts what is in it.
#
#   runtime/smoke-test.sh <archive> [--skip-orchestration] [--skip-agent-server] [--skip-services]
#
# 1. Checks the archive against its .sha256 file when one sits next to it.
# 2. Reads manifest.json and checks that every path it names exists.
# 3. initdb, pg_ctl start, createdb artel, CREATE EXTENSION vector, one vector query.
# 4. Starts orchestration with the bundled-mode environment (ARTEL_STORE=postgres,
#    ARTEL_STORAGE=filesystem) and waits until GET /api/auth/me answers with any status.
# 5. Starts agent-server with SESSION_STORE=memory and waits until GET /health answers 200.
# 6. Stops everything and removes the temporary directory.
#
# --skip-services skips steps 4 and 5. They need the orchestration and agent-server changes
# from ARTEL-1141, ARTEL-1142 and ARTEL-1143; until those are merged, develop still expects
# Redis and S3.
#
# SMOKE_TIMEOUT (seconds, default 240) bounds each wait. SMOKE_KEEP=1 keeps the directory.
set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$RUNTIME_DIR/lib.sh"

archive=''
run_orchestration=1
run_agent_server=1
for arg in "$@"; do
  case "$arg" in
    --skip-orchestration) run_orchestration=0 ;;
    --skip-agent-server) run_agent_server=0 ;;
    --skip-services) run_orchestration=0 run_agent_server=0 ;;
    -*) die "unknown option: $arg" ;;
    *) archive="$arg" ;;
  esac
done
[ -f "$archive" ] || die "usage: runtime/smoke-test.sh <archive> [--skip-orchestration] [--skip-agent-server] [--skip-services]"
archive="$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")"
timeout="${SMOKE_TIMEOUT:-240}"

if [ -f "$archive.sha256" ]; then
  line="$(cat "$archive.sha256")"
  [ "${line#*  }" = "$(basename "$archive")" ] || die "$archive.sha256 does not name $(basename "$archive"): $line"
  verify_sha256 "$archive" "${line%%  *}"
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/artel-smoke.XXXXXX")"
runtime="$work/runtime"
data="$work/data"
mkdir -p "$runtime" "$data/storage" "$work/logs"

pids=()
pg_ctl=''
cleanup() {
  local status=$?
  for pid in "${pids[@]+"${pids[@]}"}"; do
    if is_windows && [ -r "/proc/$pid/winpid" ]; then
      taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" > /dev/null 2>&1 || true
    fi
    kill "$pid" 2> /dev/null || true
  done
  if [ -n "$pg_ctl" ] && [ -f "$data/pgdata/postmaster.pid" ]; then
    "$pg_ctl" -D "$(native_path "$data/pgdata")" -m fast -w stop > /dev/null 2>&1 || true
  fi
  if [ "$status" != 0 ]; then
    for file in "$work"/logs/*.log; do
      [ -f "$file" ] || continue
      printf '\n----- %s (last 60 lines) -----\n' "$(basename "$file")" >&2
      tail -n 60 "$file" >&2
    done
  fi
  if [ "${SMOKE_KEEP:-0}" = 1 ]; then
    log "kept $work"
  else
    rm -rf "$work"
  fi
  exit "$status"
}
trap cleanup EXIT

log "unpack $(basename "$archive")"
tar -xzf "$archive" -C "$runtime"
manifest="$runtime/manifest.json"
[ -f "$manifest" ] || die "manifest.json is not at the archive root"

# Value of a string field in the manifest. The manifest is written one field per line.
manifest_get() {
  sed -n "s/^ *\"$1\": *\"\\([^\"]*\\)\".*/\\1/p" "$manifest" | head -n 1
}

for key in postgres initdb pg_ctl pg_isready createdb java python orchestrationJar agentServerDir homeDir; do
  value="$(manifest_get "$key")"
  [ -n "$value" ] || die "manifest.json has no $key"
  [ -e "$runtime/$value" ] || die "manifest.json names $value for $key, which is not in the bundle"
done
[ -f "$runtime/$(manifest_get agentServerDir)/app/main.py" ] || die "agent-server/app/main.py missing"
[ -f "$runtime/$(manifest_get homeDir)/index.html" ] || die "home/index.html missing"
grep -rqF __ARTEL_ORCHESTRATION_URL__ "$runtime/$(manifest_get homeDir)" || die "home is not built with the __ARTEL_ORCHESTRATION_URL__ placeholder"
log "manifest ok: target $(manifest_get target), version $(manifest_get version)"

bin() { printf '%s/%s' "$runtime" "$(manifest_get "$1")"; }
# Exercise the native OpenSSL binding after extracting the bundle.
"$(bin python)" -I -c '
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
cipher = AESGCM(AESGCM.generate_key(bit_length=256))
nonce = bytes(12)
message = b"artel-runtime-smoke"
assert cipher.decrypt(nonce, cipher.encrypt(nonce, message, None), None) == message
'
log "cryptography AES-GCM round trip ok"
pg_ctl="$(bin pg_ctl)"
pg_bin="$(dirname "$pg_ctl")"
exe="$(exe_suffix "$(manifest_get target)")"

free_port() {
  "$(bin python)" -I -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()' | tr -d '\r'
}

# wait_http <name> <url> <accepted status pattern> <pid>
wait_http() {
  local name="$1" url="$2" accept="$3" pid="$4" deadline=$((SECONDS + timeout)) code
  while [ "$SECONDS" -lt "$deadline" ]; do
    kill -0 "$pid" 2> /dev/null || die "$name exited before it answered $url"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)"
    case "$code" in
      $accept)
        log "$name ready: GET $url -> $code"
        return
        ;;
    esac
    sleep 2
  done
  die "$name did not answer $url within ${timeout}s (last status ${code:-none})"
}

# --- postgres and pgvector ----------------------------------------------------------------
db_password="smoke-$RANDOM$RANDOM"
printf '%s\n' "$db_password" > "$work/pwfile"
pg_port="$(free_port)"

log "initdb"
"$(bin initdb)" -D "$(native_path "$data/pgdata")" -U artel -A scram-sha-256 \
  --pwfile="$(native_path "$work/pwfile")" -E UTF8 --no-locale > "$work/logs/initdb.log" 2>&1
cat >> "$data/pgdata/postgresql.conf" << EOF
port = $pg_port
listen_addresses = '127.0.0.1'
unix_socket_directories = ''
shared_buffers = 32MB
EOF

log "pg_ctl start on port $pg_port"
"$pg_ctl" -D "$(native_path "$data/pgdata")" -l "$(native_path "$work/logs/postgres.log")" -w -t 60 start > /dev/null
"$(bin pg_isready)" -h 127.0.0.1 -p "$pg_port"

export PGPASSWORD="$db_password"
"$(bin createdb)" -h 127.0.0.1 -p "$pg_port" -U artel artel
distance="$("$pg_bin/psql$exe" -h 127.0.0.1 -p "$pg_port" -U artel -d artel -v ON_ERROR_STOP=1 -At \
  -c 'CREATE EXTENSION vector' \
  -c "SELECT extversion FROM pg_extension WHERE extname = 'vector'" \
  -c "SELECT '[1,2,3]'::vector <-> '[3,2,1]'::vector" | tr -d '\r')"
log "pgvector: $(printf '%s' "$distance" | tr '\n' ' ')"
[ "$(printf '%s\n' "$distance" | sed -n 2p)" = "$(manifest_get pgvector)" ] \
  || die "pgvector version does not match manifest $(manifest_get pgvector)"
case "$(printf '%s\n' "$distance" | tail -n 1)" in 2.828427*) ;; *) die "unexpected vector distance" ;; esac
# Orchestration's Flyway creates the extension itself; give it an empty database.
"$pg_bin/psql$exe" -h 127.0.0.1 -p "$pg_port" -U artel -d artel -q -c 'DROP EXTENSION vector'
log "postgres and pgvector ok"

# --- orchestration --------------------------------------------------------------------------
api_port="$(free_port)"
internal_port="$(free_port)"
agent_port="$(free_port)"
public_url="http://127.0.0.1:$api_port"

if [ "$run_orchestration" = 1 ]; then
  log "orchestration on port $api_port (internal $internal_port)"
  (
    export ARTEL_STORE=postgres ARTEL_STORAGE=filesystem
    export ARTEL_STORAGE_DIR
    ARTEL_STORAGE_DIR="$(native_path "$data/storage")"
    export SERVER_PORT="$api_port" ARTEL_INTERNAL_API_PORT="$internal_port"
    export DB_HOST=127.0.0.1 DB_PORT="$pg_port" DB_NAME=artel DB_USERNAME=artel DB_PASSWORD="$db_password" DB_SSL_MODE=disable
    export ARTEL_AGENT_BASE_URL="http://127.0.0.1:$agent_port/internal" ARTEL_AGENT_WS_BASE_URL="ws://127.0.0.1:$agent_port/internal"
    export ARTEL_HOME_URL="$public_url" ARTEL_ALLOWED_ORIGINS="$public_url"
    export ARTEL_JWT_SECRET="smoke-test-jwt-secret-$RANDOM$RANDOM-0123456789abcdef0123456789abcdef"
    export ARTEL_SECRETS_KEY
    ARTEL_SECRETS_KEY="$("$(bin python)" -I -c 'import secrets; print(secrets.token_hex(32))' | tr -d '\r')"
    export ARTEL_SECURE_COOKIE=false ARTEL_SIGNUP_OPEN=false ARTEL_GITHUB_SIGNUP_OPEN=false
    export LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_WEB=INFO LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_WEB_REACTIVE=INFO
    exec "$(bin java)" -Xmx512m -XX:+UseSerialGC -jar "$(native_path "$(bin orchestrationJar)")"
  ) > "$work/logs/orchestration.log" 2>&1 &
  pids+=("$!")
  wait_http orchestration "$public_url/api/auth/me" '[1-5][0-9][0-9]' "$!"
else
  log "orchestration skipped"
fi

# --- agent-server ---------------------------------------------------------------------------
if [ "$run_agent_server" = 1 ]; then
  log "agent-server on port $agent_port"
  (
    cd "$runtime/$(manifest_get agentServerDir)"
    export SESSION_STORE=memory APP_PORT="$agent_port" APP_ENV=production LANGSMITH_TRACING=false
    export ORCHESTRATION_BASE_URL="http://127.0.0.1:$internal_port"
    exec "$(bin python)" -m uvicorn app.main:app --host 127.0.0.1 --port "$agent_port"
  ) > "$work/logs/agent-server.log" 2>&1 &
  pids+=("$!")
  wait_http agent-server "http://127.0.0.1:$agent_port/health" 200 "$!"
else
  log "agent-server skipped"
fi

log "smoke test passed"
