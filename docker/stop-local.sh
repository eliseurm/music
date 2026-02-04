#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[stop-local] Stopping and removing services (db, back, front)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down -v

echo "[stop-local] All services stopped and removed."
