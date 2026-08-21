#!/bin/bash
# Aplica la migración 115 vía la Management API.
# `db push` se niega mientras el historial local y el de producción no coincidan
# (huecos 103-107 y 111, pre-existentes) — mismo camino que usaron las 112-114.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source /Users/mataldao/Local/.env
set +a

REF="aixjejdoofervrkggbkd"
SQL_FILE="supabase/migrations/115_link_de_referido_del_profesional.sql"

python3 - "$SQL_FILE" > /tmp/payload-115.json <<'PY'
import json, sys
sql = open(sys.argv[1]).read()
print(json.dumps({"query": sql}))
PY

curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/payload-115.json
echo
