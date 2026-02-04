#!/usr/bin/env bash
set -euo pipefail

# 1. Configurações de Identificação
export PROJECT_ID=music-project-486219
export REGION=southamerica-east1
export SERVICE_FRONT=music-front

: "${PROJECT_ID:?Defina PROJECT_ID}"
: "${REGION:?Defina REGION}"
: "${SERVICE_FRONT:?Defina SERVICE_FRONT}"

# Definição do caminho da imagem no Artifact Registry
IMAGE_FRONT="${REGION}-docker.pkg.dev/${PROJECT_ID}/music/${SERVICE_FRONT}:latest"

# O ROOT_DIR assume que o script está dentro da pasta /docker ou similar
ROOT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"

# 2. Habilitar serviços necessários no Google Cloud
echo "[cloudrun] Habilitando APIs necessárias..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project="${PROJECT_ID}"

# 3. Cria o repositório e aguarda a conclusão
echo "[cloudrun] Garantindo que o repositório 'music' existe..."
# Removemos o --async para que o gcloud espere o repositório ser criado
gcloud artifacts repositories create music \
    --repository-format=docker \
    --location="${REGION}" \
    --project="${PROJECT_ID}" \
    --description="Repositorio Music" 2> /dev/null || true


# 4. Autenticação do Docker
echo "[cloudrun] Configurando autenticação do Docker..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" -q

# 5. Build e Push da Imagem
# IMPORTANTE: Corrigido o caminho do Dockerfile para docker/Dockerfile.front
echo "[cloudrun] Buildando frontend localmente e enviando para o Artifact Registry..."
docker build -f "${ROOT_DIR}/docker/Dockerfile.front" -t "${IMAGE_FRONT}" "${ROOT_DIR}"
docker push "${IMAGE_FRONT}"

# 6. Deploy para o Cloud Run
echo "[cloudrun] Fazendo deploy do frontend no Cloud Run..."
gcloud run deploy "${SERVICE_FRONT}" \
  --region "${REGION}" \
  --image "${IMAGE_FRONT}" \
  --platform managed \
  --allow-unauthenticated \
  --port 80 \
  --project="${PROJECT_ID}"

# 7. Obter URL final
FRONT_URL=$(gcloud run services describe "${SERVICE_FRONT}" --region "${REGION}" --project="${PROJECT_ID}" --format='value(status.url)')

echo "[cloudrun] Deploy concluído com sucesso!"
echo "  URL do Frontend: ${FRONT_URL}"