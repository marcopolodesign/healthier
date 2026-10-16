# REVIEW.md — cómo se revisa un pase a producción (website + Supabase)

Lo leen `/code-review` y `/security-review` antes de revisar un diff de este repo, y
`scripts/pre-prod-review.py` lee de acá los niveles de riesgo (bloque `riesgo`, abajo).
Todo corre local, con la suscripción de Claude Code. Nada de Actions ni API key.

## 1. Cómo se ve una falla grave EN ESTE REPO

Si el diff puede producir cualquiera de estas, el hallazgo es **Importante**, aunque el
cambio parezca chico. Cada una ya pasó o estuvo a punto de pasar.

1. **Receta mal emitida o al paciente equivocado.** `rcta-issue` arma la receta con el
   paciente, profesional y consulta de `clinical_medications`. Importante si: mezcla
   medicamentos de dos consultas/pacientes, toma el titular en vez del familiar (grupo
   familiar: el familiar hereda el mail del titular), deja emitir sin firma
   (`RCTA_FIRMA_FALTANTE` va ANTES de llamar a la API), deja recetar a una especialidad
   sin permiso (`profesional_puede_recetar`, herramienta `herramienta_receta` de la
   vertical), manda texto libre donde la API espera código (`regNo`, `idFinanciador`), o
   usa un `idFinanciador` de homologación en producción (381 ids apuntan a otra entidad).
   Emitir en prod es un acto médico: ningún script ni test puede emitir contra prod.
2. **Plata: Mercado Pago y comisión por profesional.** `mp-payment`, `mp-capture`,
   `mp-refund`, `mp-webhook`, `mp-connect`, `mp-refresh-tokens`, `pharmacy-mp-connect`,
   `mp-save-card`. Importante si: cambia el cálculo de `comision_efectiva` / `application_fee`
   (0% a los pacientes referidos del profesional), cobra a quien no corresponde, cobra sin
   que nadie haya aceptado (Teleclínica: nadie acepta → no se cobra; la pre-autorización va
   contra el MP del profesional que aceptó), pierde idempotencia en el webhook, o le prende
   `verify_jwt` a una de las 4 funciones públicas de `supabase/config.toml`.
3. **RLS y permisos que expongan datos de pacientes.** Policies nuevas o cambiadas,
   `security definer` sin `search_path` fijo, RPCs que no chequean `auth.uid()`, `get_my_role()`,
   policies recursivas sobre `profiles` (ya tumbó el login), funciones con service role que no
   verifican quién llama. Cuentas de prueba (`profiles.es_prueba`, migración 186) sólo se
   cruzan con cuentas de prueba: romper ese aislamiento es Importante.
4. **Migraciones de Supabase.** Numeradas, aplicadas con `scripts/aplicar-migracion.sh N
   staging` y después `prod`, en orden. Importante si: es destructiva sin respaldo (`drop`,
   `alter type`, `not null` sin default sobre tabla con filas), el código del diff depende de
   una migración que no está en el diff, o hay DDL que no vive en un archivo.
5. **Edge Functions.** Cualquier función nueva o tocada: quién la puede llamar, qué hace con
   la service role, si un error de lectura se presenta como "éxito". Secrets siempre en
   Supabase secrets, nunca `VITE_*` (todo `VITE_*` es público en el bundle — pasó con Gemini).
6. **Despacho de emergencias (S.O.S.) y Teleclínica / consulta inmediata.** La toma del
   pedido tiene que ser atómica (el primero que acepta se lo queda), el latido/vigencia de
   disponibilidad se escribe en la base, S.O.S. en prod sólo para cuentas de prueba e
   internas (migración 187). Importante si dos profesionales pueden quedarse con el mismo
   pedido, o un paciente queda "buscando" para siempre sin aviso.
7. **Verificación de matrícula.** `sisa-verify` (REFEPS por el bus FHIR del Ministerio).
   Importante si un profesional sin verificar puede atender, recetar o cobrar, o si un
   fallo del servicio externo se toma como "verificado".
8. **Datos al Ministerio.** `federador-paciente` / `refes-consultorio` mandan datos de
   pacientes y consultorios afuera: qué se manda y a quién.
9. **Nombres de proveedores en copy.** "Innovamed", "RCTA" y "Qbitos" no aparecen en texto
   visible al usuario (comentarios y código sí). Decir "receta electrónica", "el servicio de
   recetas". El script lo chequea en las líneas agregadas, pero el revisor lo confirma.
10. **Mails disparados desde el front.** Un mail nuevo va en `templates.ts` + `send-email`,
   disparado por trigger de la base; un `functions.invoke('send-email')` suelto deja a la
   app sin avisar.
11. **Capacidad de plataforma invisible al super admin** (pagos, comisiones, verificaciones,
   configuraciones que no se ven en `/super-admin/*`): **Menor**, salvo que esconda plata.

## 2. Cómo se reporta

- **El resumen arranca con el conteo**: `Importante: N · Menor: N · Ya existía: N`. Si no hay
  nada que arreglar, lo dice en la primera línea: **"Nada que arreglar."**
- Cada hallazgo lleva **`archivo:línea`** como evidencia y una frase de qué pasa en la
  pantalla o en la base si sale así. Sin `archivo:línea`, no es un hallazgo.
- Tres marcas, nada más:
  - **Importante** — puede producir una de las fallas de la sección 1, o rompe algo que hoy
    anda. Se arregla o se justifica por escrito antes de pasar a prod.
  - **Menor** — vale la pena, no frena el pase. **Tope: 5 por revisión.** Los nits de estilo
    no se reportan.
  - **Ya existía** — el problema está en código que el diff no introdujo. Se anota, **no se
    le culpa al cambio** y no frena el pase.
- **Máximo 3 rondas** de revisión → arreglo → revisión sobre el mismo pase. Si en la tercera
  sigue habiendo Importantes, se frena y se le pregunta a Mateo.

## 3. Qué no se revisa

`package-lock.json`, `deno.lock`, `dist/`, `test-results/`, `public/docs/**` (capturas y
HTML de documentación), `docs/**/*.png`, `supabase/.temp/`. Los `.md` se miran sólo para
detectar credenciales.

## 4. Niveles de riesgo

Los decide **qué toca** el diff, no quién lo escribió. El nivel del pase es el más alto de
todos sus archivos.

**Ningún nivel sale solo: todo pase a prod se le pregunta a Mateo** (Mateo, 2026-10-16). El
nivel cambia qué se le muestra y con cuánto cuidado:

- **Alto** → se le pregunta con la revisión, el plan de pase en orden y las pruebas desde el
  front. Pide su OK explícito aunque la revisión salga limpia.
- **Medio** → se le pregunta con la revisión; no se le pide el OK con Importantes abiertos sin
  arreglar o justificar.
- **Bajo** → también se le pregunta, sólo con la revisión adjunta (una línea alcanza).

Formato: `nivel  glob  [:: regex]`. Gana **la primera regla que coincide**. Con `:: regex`,
la regla sólo aplica si alguna línea agregada o quitada del archivo coincide. Lo que no
coincide con ninguna regla es **medio**.

```riesgo
ignorar  package-lock.json
ignorar  deno.lock
ignorar  dist/**
ignorar  test-results/**
ignorar  supabase/.temp/**

# Alto — base, funciones, plata, recetas, permisos, despacho, datos al Ministerio
alto     supabase/migrations/**
alto     supabase/functions/**
alto     supabase/config.toml
alto     vercel.json
alto     src/lib/supabase.js
alto     src/lib/permisos.js
alto     src/lib/mercadoPago.js
alto     src/lib/tarifas.js
alto     src/lib/datosReceta.js
alto     src/lib/firmaImagen.js
alto     src/lib/onDemandPool.js
alto     src/lib/reverificacion.js
alto     src/lib/edgeFunction.js
alto     src/services/mpService.js
alto     src/services/paymentsService.js
alto     src/services/comisionService.js
alto     src/services/rctaService.js
alto     src/services/firmaService.js
alto     src/services/authService.js
alto     src/services/ondemandService.js
alto     src/services/emergencyService.js
alto     src/services/emergencyTrackingService.js
alto     src/services/familyService.js
alto     src/services/adminService.js
alto     src/services/ministerioService.js
alto     src/components/payment/**
alto     src/App.jsx  :: RequireRole|ProtectedLayout|ROLE_REDIRECTS|allowed=
alto     src/**       :: (functions\.invoke|callEdgeFunction|invocar)\(\s*['"`](mp-|pharmacy-mp|rcta-|sisa-verify|impersonate-user|delete-account|dar-de-baja|acceso-familiar|webview-session|ondemand-despacho)
alto     src/**       :: service_role|SERVICE_ROLE
alto     src/**       :: puedeRecetar|puede_recetar|herramienta_receta|RequireVerified|is_verified|verification_status

# Bajo — documentación, pruebas, landings de marketing, scripts de verificación
bajo     docs/**
bajo     **/*.md
bajo     public/docs/**
bajo     tests/**
bajo     scripts/verificar-*
bajo     scripts/seed-*
bajo     scripts/gen-*
bajo     scripts/preview-emails.ts
bajo     src/pages/landing/**
bajo     src/components/landing/**

# Medio — el resto del front, dependencias, scripts que tocan bases
medio    package.json
medio    scripts/**
medio    src/**
```

## 5. El procedimiento

Ver la sección **"Antes de pasar a producción — revisión"** en el `CLAUDE.md` de Healthier
(`~/Local/Healthier/CLAUDE.md`). En corto:

```bash
python3 scripts/pre-prod-review.py                       # staging vs main
python3 scripts/pre-prod-review.py --head origin/feat/x  # una rama que va a main
python3 scripts/pre-prod-review.py --commits a1b2c3,d4e5f6   # cherry-picks puntuales
```

Después `/code-review high <rama o diff>` y `/security-review` sobre el mismo diff.
