#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Migraciones huérfanas — chequeo de 3 puntas
#
# Una migración es "huérfana" cuando su SQL vive en producción pero el archivo
# no está en main, o al revés. Pasó el 2026-08-06: las migraciones 082 y 083 del
# worktree `fix-alta-cuenta-y-obra-social` se aplicaron a la base y el worktree
# nunca se mergeó. Producción tenía el trigger `crear_perfil_al_registrarse` y
# las columnas de cobertura del paciente sin un solo archivo que las explicara —
# y el código de main ya dependía de ellas. Un `db reset` habría dado una base
# rota, y nadie se hubiera enterado hasta ese momento.
#
# Uso:  bash scripts/check-migraciones-huerfanas.sh
# Sale con código 1 si encuentra algo. Sólo lee: no toca la base ni el repo.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
PROJECT_REF=aixjejdoofervrkggbkd
# Huecos de numeración ya explicados — un renumerado deja el número viejo vacío
# para siempre y no hay nada que arreglar. 083 → 096 el 2026-08-06.
HUECOS_CONOCIDOS="083"
# shellcheck disable=SC1091
source /Users/mataldao/Local/.env 2>/dev/null

problemas=0
aviso() { echo "  ⚠️  $*"; problemas=$((problemas + 1)); }

# ── 1. Archivos sin commitear ────────────────────────────────────────────────
echo "1) Archivos de migración sin commitear"
sin_commit=$(git status --porcelain -- supabase/migrations | awk '{print $2}')
if [ -n "$sin_commit" ]; then
  echo "$sin_commit" | while read -r f; do echo "  ⚠️  $f"; done
  problemas=$((problemas + 1))
else
  echo "  ok"
fi

# ── 2. Migraciones que viven sólo en un worktree ─────────────────────────────
echo
echo "2) Migraciones que existen en un worktree y no en esta rama"
encontradas=0
for w in .claude/worktrees/*/; do
  [ -d "$w/supabase/migrations" ] || continue
  extra=$(comm -13 <(ls -1 supabase/migrations | sort) <(ls -1 "$w/supabase/migrations" | sort))
  if [ -n "$extra" ]; then
    echo "  ⚠️  $(basename "$w"):"
    echo "$extra" | sed 's/^/        /'
    encontradas=1
  fi
done
if [ "$encontradas" = 1 ]; then
  problemas=$((problemas + 1))
  echo "      → mergear la rama, o traer el archivo con número nuevo si el SQL ya se aplicó"
else
  echo "  ok"
fi

# ── 3. Local vs. producción ──────────────────────────────────────────────────
echo
echo "3) Historial local vs. producción"
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "  (sin SUPABASE_ACCESS_TOKEN en ~/Local/.env — se saltea)"
else
  remotas=$(curl -s -X POST \
    "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"query":"select version from supabase_migrations.schema_migrations order by version;"}' \
    | python3 -c 'import sys,json; print("\n".join(r["version"] for r in json.load(sys.stdin)))' 2>/dev/null)

  if [ -z "$remotas" ]; then
    aviso "no se pudo leer supabase_migrations.schema_migrations"
  else
    locales=$(ls -1 supabase/migrations | sed -E 's/^([0-9]+)_.*/\1/' | sort)
    faltan_en_prod=$(comm -23 <(echo "$locales") <(echo "$remotas" | sort))
    faltan_en_repo=$(comm -13 <(echo "$locales") <(echo "$remotas" | sort))
    [ -n "$faltan_en_prod" ] && { echo "  ⚠️  en el repo y NO aplicadas en prod (correr db push):"; echo "$faltan_en_prod" | sed 's/^/        /'; problemas=$((problemas + 1)); }
    [ -n "$faltan_en_repo" ] && { echo "  ⚠️  aplicadas en prod y SIN archivo en el repo (huérfanas):"; echo "$faltan_en_repo" | sed 's/^/        /'; problemas=$((problemas + 1)); }
    [ -z "$faltan_en_prod$faltan_en_repo" ] && echo "  ok"
  fi
fi

# ── 4. Huecos en la numeración ───────────────────────────────────────────────
echo
echo "4) Huecos en la numeración"
export HUECOS_CONOCIDOS
huecos=$(ls -1 supabase/migrations | sed -E 's/^0*([0-9]+)_.*/\1/' | sort -n | python3 -c '
import sys, os
ns = {int(l) for l in sys.stdin if l.strip()}
conocidos = {int(x) for x in os.environ.get("HUECOS_CONOCIDOS", "").split()}
faltan = [n for n in range(min(ns), max(ns) + 1) if n not in ns and n not in conocidos]
print(" ".join(f"{n:03d}" for n in faltan))
')
if [ -n "$huecos" ]; then
  echo "  ⚠️  faltan: $huecos"
  echo "      → un hueco suele ser una migración que quedó en un worktree sin mergear"
  problemas=$((problemas + 1))
else
  echo "  ok"
fi

echo
if [ "$problemas" -gt 0 ]; then
  echo "❌ $problemas punto(s) para revisar."
  exit 1
fi
echo "✅ Sin migraciones huérfanas."
