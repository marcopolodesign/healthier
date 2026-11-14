#!/usr/bin/env bash
# Control de la migración 239: ninguna cuenta dada de baja puede seguir con un
# login de Google/Apple atado (si no, quien vuelve con Google cae en la cuenta
# baneada y no puede registrarse). Sale con 1 si encuentra alguna.
#   bash scripts/verificar-bajas-sin-google.sh staging|prod
set -euo pipefail
set -a; source /Users/mataldao/Local/.env; set +a
case "${1:?staging|prod}" in
  staging) REF="$HEALTHIER_STAGING_SUPABASE_REF" ;;
  prod)    REF="aixjejdoofervrkggbkd" ;;
esac
SQL="select count(*) as n from auth.identities i join public.profiles p on p.id = i.user_id where p.deleted_at is not null and i.provider <> 'email'"
N=$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$SQL" \
  | curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @- \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["n"])')
if [ "$N" != "0" ]; then echo "✗ $1: $N cuentas dadas de baja con login de Google/Apple atado"; exit 1; fi
echo "✓ $1: ninguna cuenta dada de baja con login de Google/Apple atado"
