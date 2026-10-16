#!/usr/bin/env python3
"""
pre-prod-review.py — qué toca un pase a producción y qué nivel de riesgo tiene.

Lee las reglas del bloque ```riesgo de REVIEW.md (en la raíz del repo), toma el diff
de lo que se va a pasar a prod, clasifica cada archivo (alto / medio / bajo / ignorar)
y dice el nivel del pase: el más alto que toque. Además corre chequeos baratos sobre
las líneas agregadas (nombres de proveedores en copy, secretos en el front) y guarda el
diff en un archivo para pasárselo a /code-review y /security-review.

Sólo lee. No toca ramas, bases ni deploys.

Uso (el mismo script vive en website/ y en mobile/):

  python3 scripts/pre-prod-review.py                         # default del repo (abajo)
  python3 scripts/pre-prod-review.py --head origin/feat/x     # una rama que va a prod
  python3 scripts/pre-prod-review.py --commits a1b2c3,d4e5f6  # cherry-picks puntuales
  python3 scripts/pre-prod-review.py --base ota:production --head HEAD   # mobile
  python3 scripts/pre-prod-review.py --json

Defaults:
  website → base origin/main, head origin/staging (lo que hay en staging vs prod).
  mobile  → base ota:production, head ota:preview. `ota:<rama>` se resuelve con
            eas-cli al commit del último EAS Update publicado en esa rama.

La comparación por defecto es de árbol completo (dos puntos): muestra cómo quedaría prod
si el head se promoviera entero, incluidos los cambios de prod que el head NO tiene
(se marcan como "pisa prod"). Con --tres-puntos compara contra el merge-base.
"""
import argparse
import json
import os
import re
import subprocess
import sys

NIVELES = {"bajo": 1, "medio": 2, "alto": 3}
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def sh(cmd, check=True):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f"Falló: {' '.join(cmd)}\n{r.stderr.strip()}")
    return r.stdout


def git(*args, check=True):
    return sh(["git", *args], check=check)


def tipo_de_repo():
    if os.path.isdir(os.path.join(ROOT, "supabase")):
        return "website"
    if os.path.exists(os.path.join(ROOT, "app.json")):
        return "mobile"
    return "otro"


# ── Reglas ────────────────────────────────────────────────────────────────────

def glob_a_regex(g):
    out, i = "", 0
    while i < len(g):
        if g.startswith("**/", i):
            out += "(?:.*/)?"; i += 3
        elif g.startswith("**", i):
            out += ".*"; i += 2
        elif g[i] == "*":
            out += "[^/]*"; i += 1
        elif g[i] == "?":
            out += "[^/]"; i += 1
        else:
            out += re.escape(g[i]); i += 1
    return re.compile("^" + out + "$")


def cargar_reglas():
    path = os.path.join(ROOT, "REVIEW.md")
    if os.path.exists(path):
        texto = open(path, encoding="utf-8").read()
    else:
        texto = git("show", "origin/main:REVIEW.md", check=False)
    m = re.search(r"```riesgo\n(.*?)```", texto, re.S)
    if not m:
        sys.exit("REVIEW.md no tiene el bloque ```riesgo — no hay reglas para clasificar.")
    reglas = []
    for linea in m.group(1).splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        nivel, _, resto = linea.partition(" ")
        glob, _, rx = resto.strip().partition("::")
        glob, rx = glob.strip(), rx.strip()
        if nivel not in ("ignorar", *NIVELES):
            sys.exit(f"Nivel desconocido en REVIEW.md: {linea}")
        reglas.append({"nivel": nivel, "glob": glob, "re": glob_a_regex(glob),
                       "rx": re.compile(rx) if rx else None, "texto": linea})
    return reglas


def clasificar(path, lineas, reglas):
    for r in reglas:
        if not r["re"].match(path):
            continue
        if r["rx"] and not any(r["rx"].search(l) for l in lineas):
            continue
        return r["nivel"], (r["glob"] + (f"  :: {r['rx'].pattern[:50]}…" if r["rx"] else ""))
    return "medio", "(sin regla → medio)"


# ── Refs ──────────────────────────────────────────────────────────────────────

def json_de(salida):
    i = salida.find("{")
    return json.loads(salida[i:]) if i >= 0 else {}


def buscar_clave(obj, clave):
    if isinstance(obj, dict):
        if obj.get(clave):
            return obj[clave]
        obj = list(obj.values())
    if isinstance(obj, list):
        for v in obj:
            r = buscar_clave(v, clave)
            if r:
                return r
    return None


def resolver(ref):
    if ref.startswith("ota:"):
        rama = ref[4:]
        lista = json_de(sh(["npx", "eas-cli", "update:list", "--branch", rama, "--limit", "1",
                            "--json", "--non-interactive"]))
        grupo = buscar_clave(lista, "group")
        if not grupo:
            sys.exit(f"No encontré EAS Updates en la rama '{rama}'.")
        vista = sh(["npx", "eas-cli", "update:view", grupo, "--json"])
        inicio = min(i for i in (vista.find("["), vista.find("{"), len(vista)) if i >= 0)
        commit = buscar_clave(json.loads(vista[inicio:] or "{}"), "gitCommitHash")
        if not commit:
            sys.exit(f"El último update de '{rama}' no tiene commit asociado.")
        existe = subprocess.run(["git", "cat-file", "-e", commit + "^{commit}"],
                                cwd=ROOT, capture_output=True).returncode == 0
        if not existe:
            git("fetch", "-q", "origin", check=False)
        return commit, f"{ref} → {commit[:7]}"
    sha = git("rev-parse", "--verify", ref + "^{commit}").strip()
    return sha, f"{ref} ({sha[:7]})"


# ── Diff ──────────────────────────────────────────────────────────────────────

def parsear_diff(texto):
    """{path: [líneas +/- sin el prefijo]} para un diff unificado."""
    archivos, actual = {}, None
    for l in texto.splitlines():
        if l.startswith("diff --git "):
            m = re.match(r"diff --git a/(.*?) b/(.*)$", l)
            actual = m.group(2) if m else None
            if actual:
                archivos.setdefault(actual, [])
        elif actual and l.startswith(("+++", "---")):
            continue
        elif actual and l[:1] in "+-" and l:
            archivos[actual].append(l[1:])
    return archivos


def lineas_agregadas(texto):
    out, actual = {}, None
    for l in texto.splitlines():
        if l.startswith("diff --git "):
            m = re.match(r"diff --git a/(.*?) b/(.*)$", l)
            actual = m.group(2) if m else None
        elif actual and l.startswith("+") and not l.startswith("+++"):
            out.setdefault(actual, []).append(l[1:])
    return out


# ── Chequeos automáticos ──────────────────────────────────────────────────────

RX_PROVEEDOR = re.compile(r"""(['"`>])[^'"`<>]*(?<![-\w./])(innovamed|rcta|qbitos)(?![-\w])""", re.I)
RX_SECRETOS = [
    (re.compile(r"\b(VITE|EXPO_PUBLIC)_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|GEMINI|OPENAI|ANTHROPIC|RCTA|RESEND|DAILY_API|MP_ACCESS|ACCESS_TOKEN_MP)"),
     "variable pública (VITE_/EXPO_PUBLIC_) con nombre de secreto"),
    (re.compile(r"AIza[0-9A-Za-z_\-]{30,}"), "clave de Google en el código"),
    (re.compile(r"\bsk-(ant-)?[A-Za-z0-9_\-]{20,}"), "clave de API (sk-…) en el código"),
    (re.compile(r"\bAPP_USR-\d{6,}"), "access token de Mercado Pago en el código"),
    (re.compile(r"eyJ[A-Za-z0-9_\-]{15,}\.eyJ[A-Za-z0-9_\-]{15,}"), "JWT literal en el código"),
]
RX_ARCHIVO_COPY = re.compile(r"^(src|app)/.*\.(jsx|tsx)$")
RX_NATIVO = re.compile(r"^(ios/|android/|plugins/|app\.json$|app\.config\.js$|eas\.json$)")
RX_DEP = re.compile(r'^\s*"[@\w./-]+":\s*"[\^~]?\d')


def es_comentario(l):
    s = l.strip()
    return s.startswith(("//", "*", "/*", "{/*", "#", "--"))


def chequear(agregadas, tipo, archivos):
    hallazgos = []
    for path, lineas in agregadas.items():
        if path.endswith(".md") or path.startswith(("docs/", "public/docs/", "scripts/", "tests/")):
            revisar_proveedor = False
        else:
            revisar_proveedor = bool(RX_ARCHIVO_COPY.match(path))
        for n, l in enumerate(lineas):
            if revisar_proveedor and not es_comentario(l):
                m = RX_PROVEEDOR.search(l)
                if m:
                    hallazgos.append(("proveedor", path, l.strip()[:120]))
            for rx, que in RX_SECRETOS:
                if rx.search(l):
                    hallazgos.append(("secreto", path, f"{que}: {l.strip()[:100]}"))
    extra = {}
    if tipo == "website":
        extra["migraciones"] = sorted(p for p in archivos if p.startswith("supabase/migrations/"))
        funcs = sorted({p.split("/")[2] for p in archivos
                        if p.startswith("supabase/functions/") and p.count("/") >= 3})
        extra["funciones"] = funcs
        extra["config_toml"] = "supabase/config.toml" in archivos
    if tipo == "mobile":
        nativos = [p for p in archivos if RX_NATIVO.match(p)]
        if "package.json" in archivos and any(RX_DEP.match(l) for l in archivos["package.json"]):
            nativos.append("package.json (dependencias)")
        extra["nativos"] = nativos
    return hallazgos, extra


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    tipo = tipo_de_repo()
    defaults = {"website": ("origin/main", "origin/staging"),
                "mobile": ("ota:production", "ota:preview")}.get(tipo, ("origin/main", "HEAD"))
    ap = argparse.ArgumentParser(description="Nivel de riesgo de un pase a producción.")
    ap.add_argument("--base", default=defaults[0], help=f"lo que hoy está en prod (default {defaults[0]})")
    ap.add_argument("--head", default=defaults[1], help=f"lo que se quiere pasar (default {defaults[1]})")
    ap.add_argument("--commits", help="lista de commits separados por coma (cherry-picks); ignora --base/--head")
    ap.add_argument("--tres-puntos", action="store_true", help="comparar contra el merge-base en vez del árbol")
    ap.add_argument("--diff-out", help="dónde guardar el diff para los revisores")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    git("fetch", "-q", "origin", check=False)
    reglas = cargar_reglas()

    pisa = {}
    if a.commits:
        shas = [git("rev-parse", "--verify", c.strip() + "^{commit}").strip() for c in a.commits.split(",") if c.strip()]
        diff = "".join(git("show", "--no-color", "--format=", "-U3", s) for s in shas)
        desc = "commits " + ", ".join(s[:7] for s in shas)
        entran = [git("log", "-1", "--format=%h %s", s).strip() for s in shas]
        base_sha = head_sha = None
    else:
        base_sha, base_desc = resolver(a.base)
        head_sha, head_desc = resolver(a.head)
        rango = f"{base_sha}...{head_sha}" if a.tres_puntos else f"{base_sha}..{head_sha}"
        diff = git("diff", "--no-color", "-U3", rango) if a.tres_puntos else git("diff", "--no-color", "-U3", base_sha, head_sha)
        desc = f"{base_desc} → {head_desc}" + ("  [merge-base]" if a.tres_puntos else "  [árbol completo]")
        entran = git("log", "--no-merges", "--format=%h %s", f"{base_sha}..{head_sha}").splitlines()

    archivos = parsear_diff(diff)
    agregadas = lineas_agregadas(diff)

    if base_sha and not a.tres_puntos:
        for p in archivos:
            log = git("log", "--no-merges", "--format=%h %s", f"{head_sha}..{base_sha}", "--", p).splitlines()
            if log:
                pisa[p] = log

    filas = []
    for p, lineas in sorted(archivos.items()):
        nivel, regla = clasificar(p, lineas, reglas)
        filas.append({"archivo": p, "nivel": nivel, "regla": regla, "pisa_prod": pisa.get(p, [])})

    contados = [f for f in filas if f["nivel"] != "ignorar"]
    nivel = max((NIVELES[f["nivel"]] for f in contados), default=0)
    nivel_txt = {0: "nada", 1: "bajo", 2: "medio", 3: "alto"}[nivel]
    hallazgos, extra = chequear({k: v for k, v in agregadas.items()
                                 if any(f["archivo"] == k and f["nivel"] != "ignorar" for f in filas)},
                                tipo, archivos)
    if tipo == "mobile" and extra.get("nativos"):
        nivel, nivel_txt = 3, "alto"

    diff_out = a.diff_out or f"/tmp/pre-prod-review-{tipo}-{(head_sha or 'commits')[:7]}.diff"
    ign = {f["archivo"] for f in filas if f["nivel"] == "ignorar"}
    with open(diff_out, "w", encoding="utf-8") as fh:
        for bloque in re.split(r"(?m)^(?=diff --git )", diff):
            m = re.match(r"diff --git a/(.*?) b/(.*)$", bloque.split("\n", 1)[0])
            if m and m.group(2) in ign:
                continue
            fh.write(bloque)

    if a.json:
        print(json.dumps({"repo": tipo, "comparando": desc, "nivel": nivel_txt, "archivos": filas,
                          "commits_que_entran": entran, "chequeos": hallazgos, "extra": extra,
                          "diff": diff_out}, ensure_ascii=False, indent=2))
        return

    cuenta = {k: sum(1 for f in filas if f["nivel"] == k) for k in ("alto", "medio", "bajo", "ignorar")}
    print(f"Pase a prod — {tipo}")
    print(f"Comparando: {desc}")
    print(f"Commits que entran: {len(entran)}")
    print(f"Archivos: {len(filas)} (alto {cuenta['alto']} · medio {cuenta['medio']} · "
          f"bajo {cuenta['bajo']} · ignorados {cuenta['ignorar']})\n")
    for k in ("alto", "medio", "bajo"):
        grupo = [f for f in filas if f["nivel"] == k]
        if not grupo:
            continue
        print(k.upper())
        for f in grupo:
            marca = "  ⚠ pisa prod" if f["pisa_prod"] else ""
            print(f"  {f['archivo']}{marca}")
            if k == "alto" and "::" in f["regla"]:
                print(f"      regla: {f['regla']}")
        print()

    if pisa:
        print(f"⚠ PISA PROD — {len(pisa)} archivo(s) tienen cambios en la base que el head no tiene.")
        print("  Promover el head entero los revertiría. Pasar por cherry-pick, o revisar si es el")
        print("  mismo cambio con otro hash:")
        for p, log in list(pisa.items())[:15]:
            print(f"  {p}  ← {log[0]}" + (f"  (+{len(log)-1})" if len(log) > 1 else ""))
        if len(pisa) > 15:
            print(f"  … y {len(pisa)-15} más (--json para la lista entera)")
        print()

    print("Chequeos automáticos")
    prov = [h for h in hallazgos if h[0] == "proveedor"]
    secr = [h for h in hallazgos if h[0] == "secreto"]
    print(f"  {'✔' if not prov else '✖'} Innovamed/RCTA/Qbitos en copy visible: {len(prov) or 'nada'}")
    for _, p, l in prov[:10]:
        print(f"      {p}: {l}")
    print(f"  {'✔' if not secr else '✖'} Secretos en el código: {len(secr) or 'nada'}")
    for _, p, l in secr[:10]:
        print(f"      {p}: {l}")
    if extra.get("migraciones"):
        nums = [re.match(r".*/(\d+)", m).group(1) for m in extra["migraciones"] if re.match(r".*/(\d+)", m)]
        print(f"  • Migraciones en el pase: {', '.join(nums)} → aplicar en orden, staging primero:")
        for n in nums:
            print(f"      bash scripts/aplicar-migracion.sh {n} prod")
        print("    y después: bash scripts/check-migraciones-huerfanas.sh")
    if extra.get("funciones"):
        print(f"  • Edge Functions a deployar: {', '.join(extra['funciones'])}")
        print("    después: node scripts/verificar-pagos.mjs (prioridad máxima)")
    if extra.get("config_toml"):
        print("  ✖ Cambia supabase/config.toml — confirmar que mp-connect, pharmacy-mp-connect,")
        print("    mp-webhook y mp-refresh-tokens siguen con verify_jwt = false.")
    if extra.get("nativos"):
        print(f"  ✖ Cambios nativos: {', '.join(extra['nativos'])}")
        print("    NO sale por OTA: hace falta build nuevo (y el runtime tiene que coincidir).")
    print()

    accion = {
        "alto": "pasa por Mateo aunque la revisión salga limpia.",
        "medio": "sale si no quedan Importantes sin arreglar o justificar; avisarle a Mateo.",
        "bajo": "puede salir sin preguntar si /code-review y /security-review están en verde.",
        "nada": "no hay nada que pasar.",
    }[nivel_txt]
    print(f"NIVEL: {nivel_txt.upper()} → {accion}")
    print(f"Diff para los revisores: {diff_out}")
    print("Siguiente: /code-review high y /security-review sobre ese diff (máximo 3 rondas).")


if __name__ == "__main__":
    main()
