#!/usr/bin/env bash
# Corre un archivo de supabase/tests/ contra staging o producción, por el mismo
# camino que `aplicar-migracion.sh` (Management API). No registra nada: es sólo
# lectura de verificación.
#
#   bash scripts/correr-test.sh cio_e164 staging
set -euo pipefail
cd "$(dirname "$0")/.."

NOMBRE="${1:?uso: correr-test.sh <nombre> <staging|prod>}"
ENTORNO="${2:?uso: correr-test.sh <nombre> <staging|prod>}"

set -a
# shellcheck disable=SC1091
source /Users/mataldao/Local/.env
set +a

case "$ENTORNO" in
  staging) REF="$HEALTHIER_STAGING_SUPABASE_REF" ;;
  prod)    REF="aixjejdoofervrkggbkd" ;;
  *) echo "entorno inválido: $ENTORNO (staging|prod)" >&2; exit 1 ;;
esac

SQL_FILE="supabase/tests/${NOMBRE}.sql"
[ -f "$SQL_FILE" ] || { echo "no encontré $SQL_FILE" >&2; exit 1; }

python3 - "$SQL_FILE" > /tmp/payload-test.json <<'PY'
import json, sys
print(json.dumps({"query": open(sys.argv[1]).read()}))
PY

curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/payload-test.json | python3 -m json.tool
