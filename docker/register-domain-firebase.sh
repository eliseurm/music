#!/usr/bin/env bash
set -euo pipefail

# register-domain-firebase.sh
#
# Registers a custom domain in Firebase Hosting and links it to the Cloud Run
# service that serves the frontend (default: presente-front). It configures a
# Firebase Hosting site that rewrites all routes to the Cloud Run service and
# assists with DNS verification/records. Optionally, if you manage DNS in
# Google Cloud DNS, it can create the required TXT/A/AAAA records automatically.
#
# Prerequisites:
#  - gcloud CLI authenticated and set to the correct project
#  - firebase-tools installed (`npm i -g firebase-tools`)
#  - Permissions: Owner/Editor on the project, DNS admin if using Cloud DNS automation
#  - Optional: `jq` if you want the script to auto-create Cloud DNS records
#
# Required env vars (defaults shown):
#   PROJECT_ID="clube-project"
#   REGION="southamerica-east1"
#   SERVICE_FRONT="presente-front"
#   DOMAIN_NAME="mensageiros.udi.br"       # The custom domain to link
#
# Optional env vars:
#   FIREBASE_SITE_ID="presente-front-site"  # Default derived from PROJECT_ID if empty
#   USE_CLOUD_DNS="false"                  # "true" to manage DNS automatically via Cloud DNS
#   DNS_ZONE=""                            # Managed zone name (required if USE_CLOUD_DNS=true)
#   DRY_RUN="false"                        # If "true", only print actions
#
# Usage:
export PROJECT_ID=clube-project
export REGION=southamerica-east1
export SERVICE_FRONT=presente-front
export DOMAIN_NAME=mensageiros.udi.br
# optional
#export USE_CLOUD_DNS=true
#export DNS_ZONE=public-zone
#   ./docker/register-domain-firebase.sh
#

PROJECT_ID=${PROJECT_ID:-clube-project}
REGION=${REGION:-southamerica-east1}
SERVICE_FRONT=${SERVICE_FRONT:-presente-front}
DOMAIN_NAME=${DOMAIN_NAME:-}
FIREBASE_SITE_ID=${FIREBASE_SITE_ID:-}
USE_CLOUD_DNS=${USE_CLOUD_DNS:-false}
DNS_ZONE=${DNS_ZONE:-}
DRY_RUN=${DRY_RUN:-false}

#echo "Elevando a versao no node"
#nvm use 20

log() { echo "[firebase-domain] $*"; }
err() { echo "[firebase-domain][ERROR] $*" >&2; }
run() { if [ "$DRY_RUN" = "true" ]; then echo "+ $*"; else eval "$@"; fi }
need_cmd() { command -v "$1" >/dev/null 2>&1 || { err "Comando requerido não encontrado: $1"; exit 1; }; }

if [ -z "${DOMAIN_NAME}" ]; then
  err "Defina DOMAIN_NAME (ex: export DOMAIN_NAME=mensageiros.udi.br)"
  exit 1
fi

need_cmd gcloud
need_cmd firebase

# Optional tool used for JSON parsing when automating Cloud DNS
if [ "$USE_CLOUD_DNS" = "true" ]; then
  if ! command -v jq >/dev/null 2>&1; then
    err "USE_CLOUD_DNS=true, porém 'jq' não foi encontrado. Instale jq ou desative USE_CLOUD_DNS."
    exit 1
  fi
fi

log "Projeto: $PROJECT_ID | Região: $REGION | Serviço Cloud Run: $SERVICE_FRONT | Domínio: $DOMAIN_NAME"

# Ensure correct project is set in gcloud
run "gcloud config set project ${PROJECT_ID} >/dev/null"

# Enable required services
log "Habilitando APIs necessárias..."
run "gcloud services enable \
  firebase.googleapis.com \
  run.googleapis.com \
  certificatemanager.googleapis.com \
  cloudresourcemanager.googleapis.com \
  siteverification.googleapis.com \
  dns.googleapis.com >/dev/null"

# Ensure the project is a Firebase project (idempotent)
log "Garantindo vínculo do projeto com Firebase..."
set +e
firebase projects:addfirebase "$PROJECT_ID" --non-interactive >/dev/null 2>&1
ADD_FB_RC=$?
set -e
if [ $ADD_FB_RC -eq 0 ]; then
  log "Projeto vinculado ao Firebase."
else
  log "Projeto já parece estar vinculado ao Firebase (ok)."
fi

# Determine site id if not provided
if [ -z "$FIREBASE_SITE_ID" ]; then
  FIREBASE_SITE_ID="${PROJECT_ID}-site"
fi

# Check if site exists
log "Verificando/criando site de Hosting: $FIREBASE_SITE_ID"
set +e
firebase hosting:sites:list --project "$PROJECT_ID" --json 2>/dev/null | jq -e --arg s "$FIREBASE_SITE_ID" '.result[] | select(.name=="projects/'"$PROJECT_ID"'/sites/\($s)")' >/dev/null
SITE_EXISTS_RC=$?
set -e
if [ $SITE_EXISTS_RC -ne 0 ]; then
  run "firebase hosting:sites:create ${FIREBASE_SITE_ID} --project ${PROJECT_ID} --non-interactive"
else
  log "Site já existe (ok)."
fi

# Get Cloud Run URL for info/debug
FRONT_URL=$(gcloud run services describe "$SERVICE_FRONT" --region "$REGION" --format='value(status.url)' || true)
if [ -n "$FRONT_URL" ]; then
  log "Cloud Run (${SERVICE_FRONT}) URL atual: ${FRONT_URL}"
else
  log "Aviso: não foi possível obter a URL do Cloud Run ${SERVICE_FRONT}. Continuando..."
fi

# Prepare temporary hosting config pointing rewrites to Cloud Run service
WORKDIR=$(mktemp -d)
cleanup() { rm -rf "$WORKDIR" || true; }
trap cleanup EXIT

cat >"$WORKDIR/firebase.json" <<JSON
{
  "hosting": {
    "site": "${FIREBASE_SITE_ID}",
    "rewrites": [
      {
        "source": "**",
        "run": {
          "serviceId": "${SERVICE_FRONT}",
          "region": "${REGION}"
        }
      }
    ]
  }
}
JSON

cat >"$WORKDIR/.firebaserc" <<JSON
{
  "projects": {
    "default": "${PROJECT_ID}"
  }
}
JSON

log "Fazendo deploy do Hosting (rewrites -> Cloud Run ${SERVICE_FRONT})..."
run "(cd \"$WORKDIR\" && firebase deploy --only hosting:${FIREBASE_SITE_ID} --project ${PROJECT_ID} --non-interactive)"

# Add custom domain
log "Registrando domínio customizado no Hosting: ${DOMAIN_NAME}"
DOMAIN_JSON="$WORKDIR/domain.json"
set +e
firebase hosting:domain:add "$DOMAIN_NAME" --site "$FIREBASE_SITE_ID" --project "$PROJECT_ID" --non-interactive --json >"$DOMAIN_JSON" 2>/dev/null
ADD_DOMAIN_RC=$?
set -e
if [ $ADD_DOMAIN_RC -ne 0 ]; then
  log "Domínio pode já estar adicionado. Tentando obter informações existentes..."
  set +e
  firebase hosting:domain:list --site "$FIREBASE_SITE_ID" --project "$PROJECT_ID" --json >"$DOMAIN_JSON" 2>/dev/null
  set -e
fi

if [ ! -s "$DOMAIN_JSON" ]; then
  err "Não foi possível obter informações do domínio via CLI do Firebase. Verifique manualmente no Console do Firebase."
  exit 1
fi

# Extract DNS records (TXT for verification and A/AAAA targets)
VERIFY_NAME=$(jq -r '.. | objects | select(has("type") and .type=="TXT") | .name | select(.)' "$DOMAIN_JSON" | head -n1 || true)
VERIFY_VALUE=$(jq -r '.. | objects | select(has("type") and .type=="TXT") | .rrdatas[]? | select(startswith("firebase="))' "$DOMAIN_JSON" | head -n1 || true)
A_TARGETS=$(jq -r '.. | objects | select(has("type") and .type=="A") | .rrdatas[]?' "$DOMAIN_JSON" | sort -u || true)
AAAA_TARGETS=$(jq -r '.. | objects | select(has("type") and .type=="AAAA") | .rrdatas[]?' "$DOMAIN_JSON" | sort -u || true)

log "Registros DNS necessários (conforme Firebase):"
if [ -n "$VERIFY_NAME" ] && [ -n "$VERIFY_VALUE" ]; then
  echo "  TXT  ${VERIFY_NAME}  \"${VERIFY_VALUE}\""
else
  echo "  TXT  (token de verificação será mostrado pelo comando do Firebase CLI se necessário)"
fi
if [ -n "$A_TARGETS" ]; then
  while read -r ip; do [ -n "$ip" ] && echo "  A    ${DOMAIN_NAME}.  ${ip}"; done <<<"$A_TARGETS"
else
  echo "  A    ${DOMAIN_NAME}.  <endereços IPv4 fornecidos pelo Firebase>"
fi
if [ -n "$AAAA_TARGETS" ]; then
  while read -r ip6; do [ -n "$ip6" ] && echo "  AAAA ${DOMAIN_NAME}.  ${ip6}"; done <<<"$AAAA_TARGETS"
else
  echo "  AAAA ${DOMAIN_NAME}.  <endereços IPv6 fornecidos pelo Firebase (se aplicável)>"
fi

if [ "$USE_CLOUD_DNS" = "true" ]; then
  if [ -z "$DNS_ZONE" ]; then
    err "USE_CLOUD_DNS=true requer DNS_ZONE (zona gerenciada)."
    exit 1
  fi
  log "Aplicando registros na Cloud DNS (zona: ${DNS_ZONE})..."
  TTL=300
  # Build transaction
  TMPTRANS="$WORKDIR/dns-transactions.sh"
  echo "gcloud dns record-sets transaction start --zone ${DNS_ZONE}" > "$TMPTRANS"
  if [ -n "$VERIFY_NAME" ] && [ -n "$VERIFY_VALUE" ]; then
    echo "gcloud dns record-sets transaction add --zone ${DNS_ZONE} --name ${VERIFY_NAME}. --type TXT --ttl ${TTL} \"${VERIFY_VALUE}\"" >> "$TMPTRANS"
  fi
  if [ -n "$A_TARGETS" ]; then
    A_ARGS=""
    while read -r ip; do [ -n "$ip" ] && A_ARGS+=" ${ip}"; done <<<"$A_TARGETS"
    echo "gcloud dns record-sets transaction add --zone ${DNS_ZONE} --name ${DOMAIN_NAME}. --type A --ttl ${TTL} ${A_ARGS}" >> "$TMPTRANS"
  fi
  if [ -n "$AAAA_TARGETS" ]; then
    AAAA_ARGS=""
    while read -r ip6; do [ -n "$ip6" ] && AAAA_ARGS+=" ${ip6}"; done <<<"$AAAA_TARGETS"
    echo "gcloud dns record-sets transaction add --zone ${DNS_ZONE} --name ${DOMAIN_NAME}. --type AAAA --ttl ${TTL} ${AAAA_ARGS}" >> "$TMPTRANS"
  fi
  echo "gcloud dns record-sets transaction execute --zone ${DNS_ZONE}" >> "$TMPTRANS"

  if [ "$DRY_RUN" = "true" ]; then
    log "DRY_RUN ativo. Transação DNS preparada:"; cat "$TMPTRANS"
  else
    bash "$TMPTRANS"
  fi
  log "Registros DNS enviados. A verificação pode levar alguns minutos."
fi

log "Acompanhando verificação do domínio (até 15 min máx, checando a cada 30s)..."
ATTEMPTS=$((15*60/30))
for i in $(seq 1 $ATTEMPTS); do
  set +e
  STATUS_JSON=$(firebase hosting:domain:list --site "$FIREBASE_SITE_ID" --project "$PROJECT_ID" --json 2>/dev/null)
  RC=$?
  set -e
  if [ $RC -eq 0 ] && echo "$STATUS_JSON" | jq -e --arg d "$DOMAIN_NAME" '.result[] | select(.domain==$d) | .status' >/dev/null; then
    STATUS=$(echo "$STATUS_JSON" | jq -r --arg d "$DOMAIN_NAME" '.result[] | select(.domain==$d) | .status')
    log "Status atual: ${STATUS}"
    if [ "$STATUS" = "ACTIVE" ] || [ "$STATUS" = "READY" ]; then
      log "Domínio está ativo no Firebase Hosting."
      break
    fi
  else
    log "Aguardando informações do Firebase..."
  fi
  sleep 30
  if [ "$i" -eq "$ATTEMPTS" ]; then
    log "Tempo limite atingido. Verifique a verificação/certificado no Console do Firebase."
  fi
done

HOSTING_URL="https://${DOMAIN_NAME}"
log "Concluído. URLs úteis:"
[ -n "$FRONT_URL" ] && echo "  Cloud Run: ${FRONT_URL}"
echo "  Domínio customizado: ${HOSTING_URL}"
