#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Aplica una migración vía la Management API y la registra en
# supabase_migrations.schema_migrations.
#
# `npx supabase db push` está frenado desde hace tiempo porque el historial
# local y el de producción no coinciden (huecos 103-107 y 111, de la rama de
# farmacia sin mergear). Todas las migraciones desde la 112 se aplicaron por
# este camino; esto lo deja escrito en un solo lugar en vez de un push-NNN.sh
# por migración.
#
#   bash scripts/aplicar-migracion.sh 137 staging
#   bash scripts/aplicar-migracion.sh 137 prod
#
# 🔴 Siempre staging primero, verificar, y recién después producción.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

NUMERO="${1:?uso: aplicar-migracion.sh <numero> <staging|prod>}"
ENTORNO="${2:?uso: aplicar-migracion.sh <numero> <staging|prod>}"

set -a
# shellcheck disable=SC1091
source /Users/mataldao/Local/.env
set +a

case "$ENTORNO" in
  staging) REF="$HEALTHIER_STAGING_SUPABASE_REF" ;;
  prod)    REF="aixjejdoofervrkggbkd" ;;
  *) echo "entorno inválido: $ENTORNO (staging|prod)" >&2; exit 1 ;;
esac

SQL_FILE=$(ls supabase/migrations/"${NUMERO}"_*.sql 2>/dev/null | head -1)
[ -n "$SQL_FILE" ] || { echo "no encontré la migración $NUMERO" >&2; exit 1; }
VERSION=$(basename "$SQL_FILE" | sed -E 's/^([0-9]+)_.*/\1/')

echo "→ $ENTORNO ($REF): $SQL_FILE"

ejecutar() {
  python3 - "$1" > /tmp/payload-migracion.json <<'PY'
import json, sys
print(json.dumps({"query": open(sys.argv[1]).read() if sys.argv[1].endswith('.sql') else sys.argv[1]}))
PY
  curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    --data @/tmp/payload-migracion.json
  echo
}

ejecutar "$SQL_FILE"

# Registrar la versión: sin esto, check-migraciones-huerfanas.sh la reporta
# como "en el repo y NO aplicada en prod" para siempre.
ejecutar "insert into supabase_migrations.schema_migrations (version, name)
          values ('$VERSION', '$(basename "$SQL_FILE" .sql)')
          on conflict (version) do nothing;"
