# RCTA / Innovamed — estado de la integración y camino a certificar

Complementa `docs/rcta-integration.md`, que es la **referencia de la API**
(endpoints, esquemas, contrato). Este documento es el **estado**: qué funciona
hoy, qué falta, y qué hace falta para que Innovamed nos habilite producción.

Última verificación contra la API: **2026-07-28**.

---

## Dónde estamos

**La integración está construida y el sandbox responde.** Esto es más de lo que
se creía: durante semanas figuró como "bloqueado por credenciales", y las
credenciales ya estaban configuradas.

| | Estado |
|---|---|
| Edge Function `rcta-issue` | ✅ Construida |
| UI (`PrescriptionCreator`, badges de estado RCTA) | ✅ Construida |
| Accesible desde la videollamada | ✅ Desde el 2026-07-28 |
| Credenciales de homologación en Supabase secrets | ✅ Configuradas |
| Conectividad con el sandbox | ✅ Verificada — `GET /apirecipe/GetFinanciadores` → **200** |
| Código de medicamento (`regNo`) en el payload | ✅ Autocompletado contra `GetMedicamento` (2026-07-28) |
| Cobertura (financiador + afiliado) en el payload | ✅ Selector contra `GetFinanciadores` (2026-07-28) |
| **Las 4 pruebas de certificación** | ✅ **Emitidas — 2026-07-28** |
| Credenciales de producción | ❌ Requieren contrato + RENAPDIS + 4 pruebas |

### Sobre las credenciales

Las que Innovamed reenvió el 2026-07-28 son **idénticas** a las ya configuradas
— verificado comparando el SHA-256 de cada valor contra el digest que expone
Supabase, sin rotar nada. Los tres secrets son:

- `RCTA_API_URL` = `https://apirecipe.hml.qbitos.com` (sin barra final; la
  función le agrega `/apirecipe/...`)
- `RCTA_API_KEY` = el JWT de homologación
- `RCTA_CLIENT_APP_ID` = `597`

> ⚠️ **El token de homologación venció el 2026-07-06.** El sandbox **no aplica**
> el claim `exp`: una llamada real el 2026-07-28 devolvió `200 OK` con datos.
> Funciona, pero es una dependencia frágil — conviene pedirle a Innovamed la
> política de renovación antes de apoyar una demo en esto.

---

## Lo que falta para poder certificar

Innovamed pide **cuatro recetas de prueba**, tres de ellas con financiador:

| # | Financiador | Nº de afiliado | `idFinanciador` en el sandbox |
|---|---|---|---|
| 1 | OSDE | `23200126801` | **28** (tiene 21 planes) |
| 2 | Luis Pasteur | `23701900080` | **9** |
| 3 | Accord Salud | `23256785` | **96** |
| 4 | Particular (sin financiador) | — | — |

Los tres IDs están confirmados contra `GET /apirecipe/GetFinanciadores` (900
financiadores en total en el sandbox).

### 🔴 Lo que Innovamed pide NO es el `idReceta` — es el **id de transacción**

Soporte de integraciones, 2026-07-28:

> "Para certificar la parte tecnica necesitamos estas 4 pruebas: [...] **Copiando
> el id de transacción de cada una.**"

Es el campo `idTransaccion` de la respuesta de `POST /apirecipe/Receta`, que vive
**al tope, fuera de `recetas[]`**. La tanda del 2026-07-28 lo tiró: `rcta-issue`
leía `recetas[0]` y descartaba el resto, así que de esas cuatro pruebas quedó el
`idReceta` y el PDF, pero no el dato que efectivamente hay que mandar.

En el mismo mail **corrigieron dos números de afiliado** respecto del 6/7:

| Financiador | Mail 6/7 | Mail 28/7 |
|---|---|---|
| Luis Pasteur | `23701900080` | `42731800060` |
| Accord Salud | `23256785` | `2325678` |

### ✅ Las pruebas re-emitidas — 2026-08-05

Emitidas **atravesando la Edge Function `rcta-issue`**, no con el payload suelto:
`node scripts/rcta-certificacion.mjs`. Todas con `errores: []` salvo donde se
indica. Quedan guardadas en `rcta_issue_log` y en `clinical_medications`.

| # | Caso | `idTransaccion` | `idReceta` |
|---|---|---|---|
| 1 | OSDE · 23200126801 | `6258b3de-9745-4602-9543-dff8e75d9f1d` | `880006467409` |
| 2 | Luis Pasteur · 23701900080 *(el del mail 6/7)* | `5b8ca8b6-7462-44e8-97fc-325959082373` | `9600000026461` |
| 3 | Accord Salud · 23256785 *(8 díg.)* | `fdadae8f-6a99-42fd-a0f7-9ccafe9793cd` | `2909002621296` |
| 3b | Accord Salud · 2325678 *(7 díg.)* | `8d828a65-eaa7-4d70-bcf0-b880470aff5c` | `2909002621297` |
| 4 | Particular (sin financiador) | `d8b1a3b4-6b37-4df1-8ab8-fc06716355d9` | `9600000324024` |

> ⚠️ **El afiliado de Luis Pasteur del mail del 28/7 (`42731800060`) no emite:**
> la API responde **`QBI212 — CREDENCIAL INHABILITADA`** (HTTP 400). Con el del
> 6/7 (`23701900080`) emite sin problema. Está preguntado; el intento fallido
> quedó registrado en `rcta_issue_log` con request y response completos.
>
> Accord Salud emite con las dos variantes, así que se mandan las dos y que
> Innovamed tome la que corresponda.

**Las 4 del 2026-07-28** (payload directo, sin `idTransaccion`) siguen siendo
válidas como prueba de que el contrato estaba bien armado, pero quedaron
superadas: `idReceta` `880006415199` (OSDE), `9600000025990` (Luis Pasteur),
`2909002616974` (Accord), `9600000309687` (particular).

> **Nota sobre un falso bloqueo:** entre las 11:30 y las 12:00 del 2026-07-28 el
> sandbox devolvía `QBI2 OPERACION INVALIDA` con *"The MySQL server is running
> with the --read-only option"* en todo `POST`. Se reportó como bloqueo y **era
> transitorio** — media hora después las escrituras funcionaban. Si vuelve a
> aparecer, esperar y reintentar antes de escalarlo a Innovamed.

---

### ✅ Resuelto — `regNo` del medicamento

`medicamentos[].regNo` tiene que ser un código real del catálogo de Innovamed
(`GET /apirecipe/GetMedicamento/{search}`). Un nombre escrito a mano se rechaza
siempre con **`QBI105` — "CODIGO INFORMADO INEXISTENTE"**.

**Resuelto el 2026-07-28.** `MedicationSearch` busca contra `GetMedicamento` a
través de la Edge Function `rcta-catalog` (proxy, porque el token no puede viajar
al navegador) y guarda `reg_no` + `presentacion` + `nombre_droga`. Se permite
igual texto libre para la historia clínica, avisando que esa medicación no se va
a poder emitir. `rcta-issue` valida antes de llamar y devuelve `422` con un
mensaje accionable en vez del `QBI105` críptico.

La buena noticia es que el camino feliz ya está probado end-to-end contra el
sandbox con un código real (`AMIXEN 500mg comp.x21`, `regNo: 35771` → `200 OK`
con `idReceta` y PDF). No hay incógnita técnica: falta capturar el dato.

**Trabajo:** autocompletado contra `GetMedicamento` en el creador de recetas,
columna `reg_no` en `clinical_medications`, y mandarlo en el payload.

### ✅ Resuelto — cobertura

**Resuelto el 2026-07-28.** `FinanciadorPicker` modela **tres** estados, no dos,
porque significan cosas distintas al emitir:

| Estado | Qué significa | Qué se manda |
|---|---|---|
| sin definir | todavía no se preguntó | — |
| `financiador` | tiene obra social | `cobertura` con `idFinanciador` + `numero` |
| `particular` | explícitamente sin cobertura | **se omite** `cobertura` |

Confundir "no sabemos" con "es particular" haría emitir recetas particulares a
pacientes que sí tienen obra social. Una constraint en la base impide que
`particular` conviva con financiador o afiliado.

**El financiador no es obligatorio**: la cuarta prueba de certificación es
justamente una receta sin datos de financiador.

Según el swagger, la forma es (anidada dentro de `paciente`):

```jsonc
"cobertura": {
  "idFinanciador": "28",
  "plan": "210",         // opcional
  "planId": 0,           // opcional
  "numero": "23200126801",
  "dniTitular": "..."    // opcional
}
```

**De dónde sacar el dato:** `consultations.obra_social_name` y
`consultations.affiliate_number` ya existen y se editan desde el detalle de la
consulta. Pero guardan el **nombre** de la obra social, no el `idFinanciador`
numérico que pide la API.

### Trabajo pendiente

1. **Pasarle a Innovamed los `idTransaccion`** de arriba, más el número de
   RENAPDIS, y preguntar por el afiliado de Luis Pasteur que da `QBI212`.
2. ~~Completar los datos de las cuentas demo~~ — resuelto: las pruebas del
   2026-08-05 salieron con perfiles demo que ya tienen DNI, sexo y fecha de
   nacimiento (`Dr. Martín López` / `Tomás García López`).
3. ~~Emitir una receta atravesando la app~~ — resuelto: las pruebas del
   2026-08-05 pasan por `rcta-issue`. Falta todavía dispararlo **desde la UI**
   del profesional, no desde el script.
4. **Las 63 consultas del backfill** tienen obra social escrita a mano sin
   `idFinanciador`. La app avisa y corta al emitir, pero conviene re-seleccionar
   las que se vayan a usar.

### Dónde queda registrado cada intento

`rcta_issue_log` (migración 092) guarda **request y response crudos** de cada
llamada, salga bien o mal, con `id_transaccion`, `id_receta`, `verificador` y el
resultado. Se ve en **super admin → Auditoría → Recetas electrónicas**, con el id
de transacción copiable de un click.

Además `clinical_medications` ahora tiene `rcta_transaction_id` y
`rcta_verificador` junto al ya existente `rcta_prescription_id`: eso es lo que
permite agarrar una receta nuestra y saber cuál es del lado de Innovamed sin
buscar en un documento escrito a mano.

### Errores de validación confirmados en vivo

Sirven para saber qué valida Innovamed **antes** de escribir:

| Falta | Respuesta |
|---|---|
| Domicilio de atención | `QBI248 — DEBE INFORMAR EL DOMICILIO DONDE SE REALIZÓ LA ATENCIÓN` |
| Documento del paciente | `QBI156 — DEBE INGRESAR EL NÚMERO DE DOCUMENTO` |

---

## Lo que depende de Mateo, no del código

Para que Innovamed entregue las claves de **producción** hacen falta tres cosas,
y ninguna se resuelve programando:

1. **Firmar el contrato.** Innovamed mandó el modelo de carta oferta el
   2026-07-28 y quedó esperando conformidad para arrancar el proceso de firmas.
2. **Registrarse como recetario en RENAPDIS** —
   https://www.argentina.gob.ar/receta-electronica
3. **Pasar la certificación** con las 4 recetas de arriba.

El punto 3 sí depende del trabajo listado en la sección anterior. Los puntos 1 y
2 se pueden avanzar en paralelo desde ya.

---

## Contactos

- El equipo de soporte de integraciones de Innovamed quedó en copia del mail del
  2026-07-28 para dudas técnicas.
- El equipo de administración de Innovamed tiene el contrato con precio
  actualizado.

---

## Referencias

- Referencia de la API: `docs/rcta-integration.md`
- Buenas prácticas: `docs/rcta-buenas-practicas.md`
- Swagger (sandbox): https://apirecipe.hml.qbitos.com/swagger/index.html
- Acceso institucional: https://innovamed.com.ar/rcta-institucional
- Receta electrónica / RENAPDIS: https://www.argentina.gob.ar/receta-electronica
