#!/usr/bin/env bash
# Build the backend image and (re)start it as a container.
# Usage: ./deploy.sh            (reads config from ./.env)
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="${IMAGE:-helios-backend}"
CONTAINER="${CONTAINER:-helios-backend}"
ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE - create it first (see CLAUDE.md for required vars)." >&2
  exit 1
fi

PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r"'"'" || true)"
PORT="${PORT:-3000}"

echo "==> Building image $IMAGE"
docker build -t "$IMAGE" .

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "==> Removing existing container $CONTAINER"
  docker rm -f "$CONTAINER" > /dev/null
fi

echo "==> Starting $CONTAINER on port $PORT"
docker run -d \
  --name "$CONTAINER" \
  --env-file "$ENV_FILE" \
  -e PORT="$PORT" \
  -p "$PORT:$PORT" \
  --restart unless-stopped \
  "$IMAGE" > /dev/null

echo "==> Waiting for health check"
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$PORT/" > /dev/null 2>&1; then
    echo "==> Backend is up at http://localhost:$PORT"
    docker image prune -f > /dev/null
    exit 0
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]; then
    break
  fi
  sleep 2
done

echo "Backend failed to start. Recent logs:" >&2
docker logs --tail 50 "$CONTAINER" >&2
exit 1
