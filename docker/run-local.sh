#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[run-local] Iniciando build e subindo containers..."
# Adicione esta linha para iniciar o Docker Compose
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up --build -d

echo "[run-local] Frontend disponível em: http://localhost:4200"